import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, accountPreferencesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

// ── GET /api/accounts ─────────────────────────────────────────────────────────
// Returns every distinct account found in transactions, merged with skip prefs.

router.get("/accounts", async (req, res) => {
  try {
    const accountRows = await db
      .select({
        accountName: transactionsTable.accountName,
        accountNumber: transactionsTable.accountNumber,
        providerName: transactionsTable.providerName,
        totalCount: sql<number>`cast(count(*) as int)`,
      })
      .from(transactionsTable)
      .groupBy(
        transactionsTable.accountName,
        transactionsTable.accountNumber,
        transactionsTable.providerName,
      );

    // Current skip preferences keyed by accountNumber
    const prefs = await db.select().from(accountPreferencesTable);
    const prefMap: Record<string, boolean> = {};
    for (const p of prefs) {
      prefMap[p.accountNumber] = p.skipped;
    }

    const accounts = accountRows.map((r) => ({
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      providerName: r.providerName,
      totalCount: r.totalCount,
      skipped: prefMap[r.accountNumber] ?? false,
    }));

    res.json({ accounts });
  } catch (err) {
    req.log.error({ err }, "Failed to list accounts");
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

// ── PATCH /api/accounts/:accountNumber ───────────────────────────────────────
// Toggle skip for an account by account number. Bulk-updates included on its transactions.

router.patch("/accounts/:accountNumber", async (req, res) => {
  try {
    const accountNumber = decodeURIComponent(req.params.accountNumber);
    const { skipped, accountName } = req.body as { skipped: boolean; accountName: string };

    if (typeof skipped !== "boolean") {
      return res.status(400).json({ error: "skipped must be a boolean" });
    }

    // Upsert preference keyed by accountNumber
    await db
      .insert(accountPreferencesTable)
      .values({ accountNumber, accountName: accountName ?? accountNumber, skipped, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: accountPreferencesTable.accountNumber,
        set: { skipped, updatedAt: new Date() },
      });

    // Bulk-update included on all transactions for this specific account number
    const updated = await db
      .update(transactionsTable)
      .set({ included: !skipped })
      .where(eq(transactionsTable.accountNumber, accountNumber))
      .returning({ id: transactionsTable.id });

    req.log.info({ accountNumber, accountName, skipped, affected: updated.length }, "Account skip updated");

    res.json({ accountNumber, accountName, skipped, affected: updated.length });
  } catch (err) {
    req.log.error({ err }, "Failed to update account skip");
    res.status(500).json({ error: "Failed to update account skip" });
  }
});

export default router;
