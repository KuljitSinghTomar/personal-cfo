import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, categoryRulesTable } from "@workspace/db";
import { eq, and, gte, lte, ilike, or, sql, desc, inArray, ne } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import {
  ListTransactionsQueryParams,
  UpdateTransactionBody,
  UpdateTransactionParams,
  ImportTransactionsBody,
} from "@workspace/api-zod";
import { autoGenerateBudgetGoals } from "./budget";
import { syncNetWorthFromTransactions } from "./net-worth";

// ── Investment detection engine ────────────────────────────────────────────

const INVESTMENT_CATEGORY_PATTERNS = [
  "super", "invest", "shares", "brokerage", "managed fund", "etf",
];

const INVESTMENT_DESCRIPTION_PATTERNS = [
  "vanguard", "commsec", "pearler", "selfwealth", "raiz", "spaceship",
  "nabtrade", "australiansuper", "hostplus", "host plus", "unisuper",
  "rest super", "cbus", "hesta", "stake", "superhero", "betashares",
  "ishares", "magellan", "argo invest", "afic",
];

function isInvestmentTransaction(categoryName: string | null, description: string): boolean {
  const cat = (categoryName ?? "").toLowerCase();
  const desc = description.toLowerCase();
  return (
    INVESTMENT_CATEGORY_PATTERNS.some((p) => cat.includes(p)) ||
    INVESTMENT_DESCRIPTION_PATTERNS.some((p) => desc.includes(p))
  );
}

export async function redetectInvestments(log?: any): Promise<{ marked: number }> {
  // Reset all to false, then re-mark based on current patterns
  await db.update(transactionsTable).set({ isInvestment: false }).where(
    eq(transactionsTable.isInvestment, true)
  );

  const catConditions = INVESTMENT_CATEGORY_PATTERNS.map((p) =>
    ilike(transactionsTable.categoryName, `%${p}%`)
  );
  const descConditions = INVESTMENT_DESCRIPTION_PATTERNS.map((p) =>
    ilike(transactionsTable.description, `%${p}%`)
  );

  const result = await db.update(transactionsTable)
    .set({ isInvestment: true })
    .where(
      and(
        eq(transactionsTable.creditDebit, "debit"),
        eq(transactionsTable.included, true),
        or(...catConditions, ...descConditions),
      )
    )
    .returning({ id: transactionsTable.id });

  const marked = result.length;
  log?.info({ marked }, "Investment re-detection complete");
  return { marked };
}

// ── Transfer pair-matching engine ─────────────────────────────────────────

export async function redetectTransfers(log?: any): Promise<{ matched: number; reset: number }> {
  // ── Step 1: Loan/mortgage account credits ────────────────────────────────────
  // When money hits a loan account as "transfer_incoming" the bank is recording
  // a repayment. Always exclude from income — no pair needed.
  // The debit leg on the offset/savings account is the real expense.
  await db
    .update(transactionsTable)
    .set({ isTransfer: true })
    .where(
      and(
        eq(transactionsTable.transactionType, "transfer_incoming"),
        or(
          ilike(transactionsTable.accountName, "%loan%"),
          ilike(transactionsTable.accountName, "%mortgage%"),
        )
      )
    );

  // ── Step 2: Category-confirmed pair-matching ─────────────────────────────────
  // Only include transactions where the CATEGORY explicitly says "transfer" or
  // "credit card payment". We do NOT rely on transaction_type alone because
  // payroll deposits (type=transfer_incoming, category=Salary/Regular Income)
  // must never be matched as transfers — they are real external income.
  // Loan accounts are excluded here (handled above in Step 1).
  const candidates = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      transactionDate: transactionsTable.transactionDate,
      accountNumber: transactionsTable.accountNumber,
    })
    .from(transactionsTable)
    .where(
      and(
        or(
          ilike(transactionsTable.categoryName, "%transfer%"),
          ilike(transactionsTable.categoryName, "%credit card payment%"),
        ),
        sql`lower(${transactionsTable.accountName}) not like '%loan%'`,
        sql`lower(${transactionsTable.accountName}) not like '%mortgage%'`,
      )
    );

  if (candidates.length === 0) return { matched: 0, reset: 0 };

  // Reset all candidates to false, then re-mark only confirmed pairs
  const candidateIds = candidates.map((c) => c.id);
  await db.update(transactionsTable).set({ isTransfer: false }).where(inArray(transactionsTable.id, candidateIds));

  const debits = candidates.filter((c) => c.creditDebit === "debit");
  const credits = candidates.filter((c) => c.creditDebit === "credit");
  const creditsByAmount = new Map<string, typeof credits>();
  for (const c of credits) {
    if (!creditsByAmount.has(c.amount)) creditsByAmount.set(c.amount, []);
    creditsByAmount.get(c.amount)!.push(c);
  }

  const matchedIds: string[] = [];
  const usedCreditIds = new Set<string>();

  for (const debit of debits) {
    const potentialCredits = creditsByAmount.get(debit.amount) ?? [];
    for (const credit of potentialCredits) {
      if (usedCreditIds.has(credit.id)) continue;
      if (debit.accountNumber === credit.accountNumber) continue;
      const daysDiff = Math.abs(
        (new Date(debit.transactionDate!).getTime() - new Date(credit.transactionDate!).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysDiff > 2) continue;
      matchedIds.push(debit.id, credit.id);
      usedCreditIds.add(credit.id);
      break;
    }
  }

  if (matchedIds.length > 0) {
    await db.update(transactionsTable).set({ isTransfer: true }).where(inArray(transactionsTable.id, matchedIds));
  }

  log?.info({ candidates: candidateIds.length, matched: matchedIds.length }, "Transfer re-detection complete");
  return { matched: matchedIds.length / 2, reset: candidateIds.length };
}

// ── Description token extraction ──────────────────────────────────────────

const NOISE_WORDS = new Set([
  "pos", "pur", "purchase", "authorisation", "authorization", "auth",
  "debit", "credit", "payment", "direct", "eftpos", "visa", "mastercard",
  "amex", "ach", "fee", "charge", "transaction", "transfer", "deposit",
  "withdrawal", "atm", "card", "online", "internet", "bpay", "paypal",
  "ref", "pay", "pmt", "aus", "pty", "ltd", "xxxx", "www", "com",
  "au", "net", "org", "the", "and", "for", "via",
]);

export function extractDescriptionTokens(description: string): string[] {
  return description
    .split(/[\s\-*\/|_,.'&+@#!]+/)
    .map((t) => t.trim())
    .filter((t) => {
      const lower = t.toLowerCase();
      return (
        t.length >= 3 &&
        !NOISE_WORDS.has(lower) &&
        !/^\d+$/.test(t) &&       // not purely numeric
        !/^x+$/i.test(t) &&       // not masking chars
        !/^\d{4}x+$/i.test(t)     // not card-number suffixes
      );
    })
    .filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
}

// ── Criteria-based query builder ──────────────────────────────────────────

export type CriterionType = "merchant" | "descriptionToken" | "account" | "amount" | "creditDebit";

export interface MatchCriterion {
  type: CriterionType;
  value: string;
}

function buildCriteriaConditions(criteria: MatchCriterion[], excludeId: string) {
  const conditions: ReturnType<typeof eq>[] = [ne(transactionsTable.id, excludeId) as any];

  for (const c of criteria) {
    switch (c.type) {
      case "merchant":
        conditions.push(ilike(transactionsTable.merchantName, c.value) as any);
        break;
      case "descriptionToken":
        conditions.push(ilike(transactionsTable.description, `%${c.value}%`) as any);
        break;
      case "account":
        conditions.push(ilike(transactionsTable.accountName, `%${c.value}%`) as any);
        break;
      case "amount":
        conditions.push(eq(transactionsTable.amount, c.value) as any);
        break;
      case "creditDebit":
        conditions.push(eq(transactionsTable.creditDebit, c.value as "credit" | "debit") as any);
        break;
    }
  }

  return and(...conditions);
}

async function runSimilarQuery(criteria: MatchCriterion[], excludeId: string) {
  const where = buildCriteriaConditions(criteria, excludeId);

  const rows = await db
    .select()
    .from(transactionsTable)
    .where(where)
    .orderBy(desc(transactionsTable.transactionDate));

  const totalAmount = rows.reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);
  const dates = rows.map((t) => t.transactionDate!).sort();
  const categories = [...new Set(rows.map((t) => t.userCategory ?? t.categoryName).filter(Boolean))];
  const samples = rows.slice(0, 5).map((t) => ({
    id: t.id,
    description: t.userDescription ?? t.description,
    amount: parseFloat(t.amount),
    creditDebit: t.creditDebit,
    transactionDate: t.transactionDate,
    category: t.userCategory ?? t.categoryName ?? null,
  }));

  return {
    count: rows.length,
    totalAmount,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    categories,
    samples,
  };
}

const router = Router();

// ── List transactions ──────────────────────────────────────────────────────

router.get("/transactions", async (req, res) => {
  try {
    // zod.coerce.boolean() uses Boolean(value) which treats the string "false" as true.
    // Manually convert string booleans before parsing.
    const rawQuery: Record<string, unknown> = { ...req.query };
    if (rawQuery.isTransfer === "false") rawQuery.isTransfer = false;
    else if (rawQuery.isTransfer === "true") rawQuery.isTransfer = true;
    if (rawQuery.isRecurring === "false") rawQuery.isRecurring = false;
    else if (rawQuery.isRecurring === "true") rawQuery.isRecurring = true;
    if (rawQuery.isInvestment === "false") rawQuery.isInvestment = false;
    else if (rawQuery.isInvestment === "true") rawQuery.isInvestment = true;
    const query = ListTransactionsQueryParams.parse(rawQuery);
    const { page, limit, startDate, endDate, category, accountName, search, creditDebit, isTransfer, isRecurring, isInvestment } = query;

    const conditions = [];
    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));
    if (category) conditions.push(or(ilike(transactionsTable.categoryName, `%${category}%`), ilike(transactionsTable.userCategory, `%${category}%`)));
    if (accountName) conditions.push(ilike(transactionsTable.accountName, `%${accountName}%`));
    if (creditDebit) conditions.push(eq(transactionsTable.creditDebit, creditDebit));
    if (isTransfer !== undefined) conditions.push(eq(transactionsTable.isTransfer, isTransfer));
    if (isRecurring !== undefined) conditions.push(eq(transactionsTable.isRecurring, isRecurring));
    if (isInvestment !== undefined) conditions.push(eq(transactionsTable.isInvestment, isInvestment));
    if (search) {
      conditions.push(or(
        ilike(transactionsTable.description, `%${search}%`),
        ilike(transactionsTable.userDescription, `%${search}%`),
        ilike(transactionsTable.merchantName, `%${search}%`)
      ));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(transactionsTable).where(where),
      db.select().from(transactionsTable).where(where).orderBy(desc(transactionsTable.transactionDate)).limit(limit).offset((page - 1) * limit),
    ]);

    res.json({
      transactions: rows.map(serializeTransaction),
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
      totalPages: Math.ceil(Number(countResult[0]?.count ?? 0) / limit),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list transactions");
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

// ── Grouped transfers ──────────────────────────────────────────────────────

router.get("/transfers/grouped", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.isTransfer, true), eq(transactionsTable.included, true)))
      .orderBy(desc(transactionsTable.transactionDate));

    const debits = rows.filter((r) => r.creditDebit === "debit");
    const credits = rows.filter((r) => r.creditDebit === "credit");

    const usedCreditIds = new Set<string>();
    const usedDebitIds = new Set<string>();
    const pairs: Array<{
      id: string;
      amount: number;
      date: string;
      daysApart: number;
      outgoing: ReturnType<typeof serializeTransaction>;
      incoming: ReturnType<typeof serializeTransaction>;
    }> = [];

    for (const debit of debits) {
      const debitAmount = parseFloat(debit.amount);
      const debitMs = new Date(debit.transactionDate!).getTime();

      // Find the closest matching credit (same amount, within 3 days)
      let bestMatch: (typeof credits)[0] | null = null;
      let bestGap = Infinity;
      for (const credit of credits) {
        if (usedCreditIds.has(credit.id)) continue;
        const creditAmount = parseFloat(credit.amount);
        if (Math.abs(creditAmount - debitAmount) > 0.01) continue;
        const gap = Math.abs(new Date(credit.transactionDate!).getTime() - debitMs);
        const days = gap / (1000 * 60 * 60 * 24);
        if (days <= 3 && gap < bestGap) { bestMatch = credit; bestGap = gap; }
      }

      if (bestMatch) {
        usedCreditIds.add(bestMatch.id);
        usedDebitIds.add(debit.id);
        const daysApart = Math.round(bestGap / (1000 * 60 * 60 * 24));
        const date = debit.transactionDate! <= bestMatch.transactionDate! ? debit.transactionDate! : bestMatch.transactionDate!;
        pairs.push({
          id: `${debit.id}__${bestMatch.id}`,
          amount: debitAmount,
          date,
          daysApart,
          outgoing: serializeTransaction(debit),
          incoming: serializeTransaction(bestMatch),
        });
      }
    }

    const unpaired = rows
      .filter((r) => !usedCreditIds.has(r.id) && !usedDebitIds.has(r.id))
      .map(serializeTransaction);

    pairs.sort((a, b) => b.date.localeCompare(a.date));

    res.json({ pairs, unpaired, totalPairs: pairs.length, totalUnpaired: unpaired.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get grouped transfers");
    res.status(500).json({ error: "Failed to get grouped transfers" });
  }
});

// ── Import CSV ─────────────────────────────────────────────────────────────

router.post("/transactions/import", async (req, res) => {
  try {
    const body = ImportTransactionsBody.parse(req.body);
    const records = parse(body.csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

    const activeRules = await db.select().from(categoryRulesTable).where(eq(categoryRulesTable.isActive, true));

    function applyRules(merchantName: string | null, description: string, categoryName: string | null): string | null {
      for (const rule of activeRules) {
        const pattern = rule.matchPattern.toLowerCase();
        if (rule.matchField === "merchant" && merchantName) {
          if (merchantName.toLowerCase().includes(pattern)) return rule.category;
        } else if (rule.matchField === "description") {
          if (description.toLowerCase().includes(pattern)) return rule.category;
        } else if (rule.matchField === "category" && categoryName) {
          if (categoryName.toLowerCase().includes(pattern)) return rule.category;
        }
      }
      return null;
    }

    let imported = 0, skipped = 0, updated = 0, errors = 0;

    for (const row of records) {
      try {
        const transactionId = row["transaction_id"];
        if (!transactionId) { errors++; continue; }

        const rawAmount = parseFloat(row["amount"] ?? "0");
        const creditDebit = row["credit_debit"] === "credit" ? "credit" : "debit";
        const included = row["included"] !== "false";
        const userTagsRaw = row["user_tags"] ?? "";
        const userTags = userTagsRaw ? userTagsRaw.replace(/^"|"$/g, "").split(",").filter(Boolean) : [];
        const isTransferType = row["transaction_type"] === "transfer_incoming" || row["transaction_type"] === "transfer_outgoing";
        const isTransferCategory = (row["category_name"] ?? "").toLowerCase().includes("transfer") ||
          (row["category_name"] ?? "").toLowerCase().includes("credit card payment");
        const merchantName = row["merchant_name"] || null;
        const description = row["description"] ?? "";
        const categoryName = row["category_name"] || null;
        const csvCreditDebit = row["credit_debit"] === "credit" ? "credit" : "debit";
        const csvIsInvestment = csvCreditDebit === "debit" && isInvestmentTransaction(categoryName, description);

        const existingRows = await db
          .select({ id: transactionsTable.id, userCategory: transactionsTable.userCategory })
          .from(transactionsTable)
          .where(eq(transactionsTable.transactionId, transactionId))
          .limit(1);

        const txData = {
          transactionId,
          description,
          userDescription: row["user_description"] || null,
          amount: Math.abs(rawAmount).toFixed(2),
          currency: row["currency"] ?? "AUD",
          transactionDate: row["transaction_date"] ?? "",
          postedDate: row["posted_date"] || null,
          accountNumber: row["account_number"] ?? "",
          accountName: row["account_name"] ?? "",
          creditDebit,
          transactionType: row["transaction_type"] ?? "",
          providerName: row["provider_name"] ?? "",
          merchantName,
          budgetCategory: row["budget_category"] || null,
          categoryName,
          userTags,
          notes: row["notes"] || null,
          isTransfer: isTransferType || isTransferCategory,
          isInvestment: csvIsInvestment,
          isRecurring: false,
          aiConfidenceScore: "0.85",
          included,
        };

        const existingRow = existingRows[0];
        if (existingRow) {
          await db.update(transactionsTable)
            .set({ ...txData, userCategory: existingRow.userCategory, updatedAt: new Date() })
            .where(eq(transactionsTable.transactionId, transactionId));
          updated++;
        } else {
          const ruleCategory = applyRules(merchantName, description, categoryName);
          await db.insert(transactionsTable).values({ id: randomUUID(), ...txData, userCategory: ruleCategory });
          imported++;
        }
      } catch { errors++; }
    }

    let transfersDetected = 0;
    try {
      const result = await redetectTransfers(req.log);
      transfersDetected = result.matched;
    } catch (e) {
      req.log.warn({ err: e }, "Transfer re-detection failed (non-fatal)");
    }

    redetectInvestments(req.log).catch((e) => req.log.warn({ err: e }, "Investment re-detection failed (non-fatal)"));
    syncNetWorthFromTransactions(req.log).catch((e) => req.log.warn({ err: e }, "Net worth sync failed"));
    autoGenerateBudgetGoals(req.log).catch((e) => req.log.warn({ err: e }, "Auto-generate budgets failed"));

    res.json({
      imported, skipped, updated, errors,
      transferPairsDetected: transfersDetected,
      message: `Imported ${imported}, updated ${updated}, skipped ${skipped}${transfersDetected > 0 ? `, ${transfersDetected} transfer pairs detected` : ""}`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import transactions");
    res.status(500).json({ error: "Failed to import transactions" });
  }
});

// ── Re-detect transfers ────────────────────────────────────────────────────

router.post("/transactions/redetect-transfers", async (req, res) => {
  try {
    const result = await redetectTransfers(req.log);
    res.json({ matched: result.matched, reset: result.reset, message: `Re-detection complete: ${result.matched} transfer pairs confirmed from ${result.reset} candidates` });
  } catch (err) {
    req.log.error({ err }, "Failed to re-detect transfers");
    res.status(500).json({ error: "Failed to re-detect transfers" });
  }
});

// ── Re-detect investments ──────────────────────────────────────────────────

router.post("/transactions/redetect-investments", async (req, res) => {
  try {
    const result = await redetectInvestments(req.log);
    res.json({ marked: result.marked, message: `Investment re-detection complete: ${result.marked} transactions marked` });
  } catch (err) {
    req.log.error({ err }, "Failed to re-detect investments");
    res.status(500).json({ error: "Failed to re-detect investments" });
  }
});

// ── Distinct categories ────────────────────────────────────────────────────

router.get("/transactions/categories", async (req, res) => {
  try {
    const rows = await db.selectDistinct({ category: transactionsTable.categoryName }).from(transactionsTable).where(sql`${transactionsTable.categoryName} is not null`).orderBy(transactionsTable.categoryName);
    const userRows = await db.selectDistinct({ category: transactionsTable.userCategory }).from(transactionsTable).where(sql`${transactionsTable.userCategory} is not null`).orderBy(transactionsTable.userCategory);
    const all = [...new Set([...rows.map((r) => r.category!), ...userRows.map((r) => r.category!)])].sort();
    res.json({ categories: all });
  } catch (err) {
    req.log.error({ err }, "Failed to list categories");
    res.status(500).json({ error: "Failed to list categories" });
  }
});

// ── Similar transactions (with criteria extraction) ────────────────────────

router.get("/transactions/:id/similar", async (req, res) => {
  try {
    const { id } = req.params;
    const [source] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id)).limit(1);
    if (!source) return res.status(404).json({ error: "Transaction not found" });

    const descriptionTokens = extractDescriptionTokens(source.description);

    // Build the default criteria (auto-select best identifiers)
    const hasMerchant = source.merchantName && source.merchantName !== "Unknown" && source.merchantName.trim() !== "";
    const defaultCriteria: MatchCriterion[] = hasMerchant
      ? [{ type: "merchant", value: source.merchantName! }]
      : descriptionTokens.slice(0, 2).map((t) => ({ type: "descriptionToken" as CriterionType, value: t }));

    const results = defaultCriteria.length > 0
      ? await runSimilarQuery(defaultCriteria, id)
      : { count: 0, totalAmount: 0, earliestDate: null, latestDate: null, categories: [], samples: [] };

    res.json({
      source: {
        merchant: hasMerchant ? source.merchantName : null,
        description: source.description,
        descriptionTokens,
        account: source.accountName,
        amount: source.amount,
        creditDebit: source.creditDebit,
        transactionType: source.transactionType || null,
      },
      defaultCriteria,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to find similar transactions");
    res.status(500).json({ error: "Failed to find similar transactions" });
  }
});

// ── Preview similar (live re-query as user changes criteria) ───────────────

router.post("/transactions/preview-similar", async (req, res) => {
  try {
    const { txId, criteria } = req.body as { txId: string; criteria: MatchCriterion[] };
    if (!txId || !Array.isArray(criteria)) {
      return res.status(400).json({ error: "txId and criteria are required" });
    }
    const results = criteria.length > 0
      ? await runSimilarQuery(criteria, txId)
      : { count: 0, totalAmount: 0, earliestDate: null, latestDate: null, categories: [], samples: [] };
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to preview similar");
    res.status(500).json({ error: "Failed to preview similar" });
  }
});

// ── Bulk recategorize ─────────────────────────────────────────────────────

router.post("/transactions/bulk-recategorize", async (req, res) => {
  try {
    const { txId, criteria, newCategory, createRule } = req.body as {
      txId: string;
      criteria: MatchCriterion[];
      newCategory: string;
      createRule: boolean;
    };

    if (!criteria || criteria.length === 0) {
      return res.status(400).json({ error: "At least one matching criterion is required" });
    }

    const where = buildCriteriaConditions(criteria, txId);
    const updated = await db
      .update(transactionsTable)
      .set({ userCategory: newCategory, updatedAt: new Date() })
      .where(where)
      .returning({ id: transactionsTable.id });

    let ruleId: string | null = null;
    if (createRule) {
      // Pick the most specific criterion for the rule:
      // merchant > descriptionToken > account
      const priorityOrder: CriterionType[] = ["merchant", "descriptionToken", "account", "amount", "creditDebit"];
      const primary = priorityOrder.map((t) => criteria.find((c) => c.type === t)).find(Boolean);

      if (primary) {
        ruleId = randomUUID();
        const matchField = primary.type === "merchant" ? "merchant"
          : primary.type === "account" ? "description"
          : "description";
        await db.insert(categoryRulesTable).values({
          id: ruleId,
          matchPattern: primary.value,
          matchField,
          category: newCategory,
          isActive: true,
        });
      }
    }

    res.json({ updated: updated.length, ruleCreated: createRule && !!ruleId, ruleId });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk recategorize");
    res.status(500).json({ error: "Failed to bulk recategorize" });
  }
});

// ── Update transaction ────────────────────────────────────────────────────

router.patch("/transactions/:id", async (req, res) => {
  try {
    const { id } = UpdateTransactionParams.parse(req.params);
    const body = UpdateTransactionBody.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.userDescription !== undefined) updateData.userDescription = body.userDescription;
    if (body.userCategory !== undefined) updateData.userCategory = body.userCategory;
    if (body.userTags !== undefined) updateData.userTags = body.userTags;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.isTransfer !== undefined) updateData.isTransfer = body.isTransfer;
    if (body.isInvestment !== undefined) updateData.isInvestment = body.isInvestment;
    if (body.isRecurring !== undefined) updateData.isRecurring = body.isRecurring;
    if (body.included !== undefined) updateData.included = body.included;

    const rows = await db.update(transactionsTable).set(updateData).where(eq(transactionsTable.id, id)).returning();
    if (!rows[0]) return res.status(404).json({ error: "Transaction not found" });
    res.json(serializeTransaction(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to update transaction");
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

function serializeTransaction(tx: typeof transactionsTable.$inferSelect) {
  return {
    id: tx.id,
    transactionId: tx.transactionId,
    description: tx.description,
    userDescription: tx.userDescription ?? null,
    amount: parseFloat(tx.amount),
    currency: tx.currency,
    transactionDate: tx.transactionDate,
    postedDate: tx.postedDate ?? null,
    accountNumber: tx.accountNumber,
    accountName: tx.accountName,
    creditDebit: tx.creditDebit,
    transactionType: tx.transactionType,
    providerName: tx.providerName,
    merchantName: tx.merchantName ?? null,
    budgetCategory: tx.budgetCategory ?? null,
    categoryName: tx.categoryName ?? null,
    userCategory: tx.userCategory ?? null,
    userTags: (tx.userTags as string[]) ?? [],
    notes: tx.notes ?? null,
    isTransfer: tx.isTransfer,
    isInvestment: tx.isInvestment,
    isRecurring: tx.isRecurring,
    aiConfidenceScore: tx.aiConfidenceScore ? parseFloat(tx.aiConfidenceScore) : null,
    included: tx.included,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}

export default router;
