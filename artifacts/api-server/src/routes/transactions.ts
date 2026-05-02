import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, ilike, or, sql, desc } from "drizzle-orm";
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
      message: `Imported ${imported}, updated ${updated}, skipped ${skipped}, errors ${errors}`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import transactions");
    res.status(500).json({ error: "Failed to import transactions" });
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
