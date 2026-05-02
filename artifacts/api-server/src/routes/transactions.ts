import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, ilike, or, sql, desc, inArray } from "drizzle-orm";
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

// ── Transfer pair-matching engine ─────────────────────────────────────────
//
// A transaction is an internal transfer ONLY when its exact opposite exists:
//   - Same amount (absolute)
//   - Same or nearby date (≤ 2 calendar days)
//   - Different account number
//   - At least one side flagged by transaction_type OR category heuristic
//
// Steps:
//   1. Collect all "candidates" (transfer_type OR transfer_category)
//   2. Reset all candidates to is_transfer = false
//   3. Greedily match (debit, credit) pairs
//   4. Mark each matched pair as is_transfer = true

export async function redetectTransfers(log?: any): Promise<{ matched: number; reset: number }> {
  // 1. Identify candidates by transaction_type or category heuristic
  const candidates = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      transactionDate: transactionsTable.transactionDate,
      accountNumber: transactionsTable.accountNumber,
      transactionType: transactionsTable.transactionType,
    })
    .from(transactionsTable)
    .where(
      or(
        eq(transactionsTable.transactionType, "transfer_incoming"),
        eq(transactionsTable.transactionType, "transfer_outgoing"),
        ilike(transactionsTable.categoryName, "%transfer%"),
        ilike(transactionsTable.categoryName, "%credit card payment%"),
      )
    );

  if (candidates.length === 0) {
    return { matched: 0, reset: 0 };
  }

  const candidateIds = candidates.map((c) => c.id);

  // 2. Reset all candidate flags — none are transfers until a pair is confirmed
  await db
    .update(transactionsTable)
    .set({ isTransfer: false })
    .where(inArray(transactionsTable.id, candidateIds));

  // 3. Greedily match (debit, credit) pairs
  const debits = candidates.filter((c) => c.creditDebit === "debit");
  const credits = candidates.filter((c) => c.creditDebit === "credit");

  // Index credits by amount for fast lookup
  const creditsByAmount = new Map<string, typeof credits>();
  for (const c of credits) {
    const key = c.amount; // stored as abs value string e.g. "150.00"
    if (!creditsByAmount.has(key)) creditsByAmount.set(key, []);
    creditsByAmount.get(key)!.push(c);
  }

  const matchedIds: string[] = [];
  const usedCreditIds = new Set<string>();

  for (const debit of debits) {
    const potentialCredits = creditsByAmount.get(debit.amount) ?? [];
    for (const credit of potentialCredits) {
      if (usedCreditIds.has(credit.id)) continue;
      if (debit.accountNumber === credit.accountNumber) continue;

      // Check date proximity (≤ 2 calendar days)
      const debitDate = new Date(debit.transactionDate!);
      const creditDate = new Date(credit.transactionDate!);
      const daysDiff = Math.abs(
        (debitDate.getTime() - creditDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysDiff > 2) continue;

      // Pair confirmed — mark both
      matchedIds.push(debit.id, credit.id);
      usedCreditIds.add(credit.id);
      break;
    }
  }

  // 4. Mark matched pairs as transfers
  if (matchedIds.length > 0) {
    await db
      .update(transactionsTable)
      .set({ isTransfer: true })
      .where(inArray(transactionsTable.id, matchedIds));
  }

  log?.info({ candidates: candidateIds.length, matched: matchedIds.length }, "Transfer re-detection complete");
  return { matched: matchedIds.length / 2, reset: candidateIds.length };
}

const router = Router();

router.get("/transactions", async (req, res) => {
  try {
    const query = ListTransactionsQueryParams.parse(req.query);
    const { page, limit, startDate, endDate, category, accountName, search, creditDebit, isTransfer, isRecurring } = query;

    const conditions = [];

    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));
    if (category) conditions.push(
      or(
        ilike(transactionsTable.categoryName, `%${category}%`),
        ilike(transactionsTable.userCategory, `%${category}%`)
      )
    );
    if (accountName) conditions.push(ilike(transactionsTable.accountName, `%${accountName}%`));
    if (creditDebit) conditions.push(eq(transactionsTable.creditDebit, creditDebit));
    if (isTransfer !== undefined) conditions.push(eq(transactionsTable.isTransfer, isTransfer));
    if (isRecurring !== undefined) conditions.push(eq(transactionsTable.isRecurring, isRecurring));
    if (search) {
      conditions.push(
        or(
          ilike(transactionsTable.description, `%${search}%`),
          ilike(transactionsTable.userDescription, `%${search}%`),
          ilike(transactionsTable.merchantName, `%${search}%`)
        )
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(transactionsTable).where(where),
      db.select().from(transactionsTable)
        .where(where)
        .orderBy(desc(transactionsTable.transactionDate))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    const transactions = rows.map(serializeTransaction);

    res.json({
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list transactions");
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.post("/transactions/import", async (req, res) => {
  try {
    const body = ImportTransactionsBody.parse(req.body);
    const { csvContent } = body;

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    let imported = 0;
    let skipped = 0;
    let updated = 0;
    let errors = 0;

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

        const existingRows = await db.select({ id: transactionsTable.id, updatedAt: transactionsTable.updatedAt })
          .from(transactionsTable)
          .where(eq(transactionsTable.transactionId, transactionId))
          .limit(1);

        const existingRow = existingRows[0];

        const txData = {
          transactionId,
          description: row["description"] ?? "",
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
          merchantName: row["merchant_name"] || null,
          budgetCategory: row["budget_category"] || null,
          categoryName: row["category_name"] || null,
          userCategory: null as string | null,
          userTags,
          notes: row["notes"] || null,
          isTransfer: isTransferType || isTransferCategory,
          isRecurring: false,
          aiConfidenceScore: "0.85",
          included,
        };

        if (existingRow) {
          await db.update(transactionsTable)
            .set({ ...txData, updatedAt: new Date() })
            .where(eq(transactionsTable.transactionId, transactionId));
          updated++;
        } else {
          await db.insert(transactionsTable).values({
            id: randomUUID(),
            ...txData,
          });
          imported++;
        }
      } catch (rowErr) {
        errors++;
      }
    }

    // Re-detect transfers using pair-matching (synchronous — must happen before response
    // so callers immediately see correct is_transfer flags)
    let transfersDetected = 0;
    try {
      const result = await redetectTransfers(req.log);
      transfersDetected = result.matched;
    } catch (e) {
      req.log.warn({ err: e }, "Transfer re-detection failed (non-fatal)");
    }

    // Sync net worth derived balances (fire-and-forget)
    syncNetWorthFromTransactions(req.log).catch((e) => {
      req.log.warn({ err: e }, "Net worth sync failed after import");
    });
    // Auto-generate budget goals from updated transaction history (fire-and-forget)
    autoGenerateBudgetGoals(req.log).catch((e) => {
      req.log.warn({ err: e }, "Auto-generate budgets failed after import (non-fatal)");
    });

    res.json({
      imported,
      skipped,
      updated,
      errors,
      transferPairsDetected: transfersDetected,
      message: `Imported ${imported}, updated ${updated}, skipped ${skipped}${transfersDetected > 0 ? `, ${transfersDetected} transfer pairs detected` : ""}`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import transactions");
    res.status(500).json({ error: "Failed to import transactions" });
  }
});

// ── Manual re-detect endpoint ──────────────────────────────────────────────

router.post("/transactions/redetect-transfers", async (req, res) => {
  try {
    const result = await redetectTransfers(req.log);
    res.json({
      matched: result.matched,
      reset: result.reset,
      message: `Re-detection complete: ${result.matched} transfer pairs confirmed from ${result.reset} candidates`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to re-detect transfers");
    res.status(500).json({ error: "Failed to re-detect transfers" });
  }
});

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
    if (body.isRecurring !== undefined) updateData.isRecurring = body.isRecurring;
    if (body.included !== undefined) updateData.included = body.included;

    const rows = await db.update(transactionsTable)
      .set(updateData)
      .where(eq(transactionsTable.id, id))
      .returning();

    if (!rows[0]) {
      return res.status(404).json({ error: "Transaction not found" });
    }

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
    isRecurring: tx.isRecurring,
    aiConfidenceScore: tx.aiConfidenceScore ? parseFloat(tx.aiConfidenceScore) : null,
    included: tx.included,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}

export default router;
