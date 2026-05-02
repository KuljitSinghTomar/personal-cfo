import { Router } from "express";
import { db } from "@workspace/db";
import { netWorthAccountsTable, netWorthSnapshotsTable, transactionsTable } from "@workspace/db";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// ── List accounts + computed totals ────────────────────────────────────────

router.get("/net-worth/accounts", async (req, res) => {
  try {
    const accounts = await db.select()
      .from(netWorthAccountsTable)
      .orderBy(asc(netWorthAccountsTable.type), asc(netWorthAccountsTable.sortOrder));

    const serialized = accounts.map(serializeAccount);
    const totalAssets = serialized.filter((a) => a.type === "asset").reduce((s, a) => s + a.currentBalance, 0);
    const totalLiabilities = serialized.filter((a) => a.type === "liability").reduce((s, a) => s + a.currentBalance, 0);

    res.json({ accounts: serialized, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities });
  } catch (err) {
    req.log.error({ err }, "Failed to list net worth accounts");
    res.status(500).json({ error: "Failed to list net worth accounts" });
  }
});

// ── Create account ──────────────────────────────────────────────────────────

router.post("/net-worth/accounts", async (req, res) => {
  try {
    const body = req.body as {
      name: string; institution?: string; type: "asset" | "liability";
      category: string; currentBalance?: number; baseBalance?: number;
      balanceSource?: string; linkedAccountNumber?: string; linkedAccountName?: string;
      isLinked?: boolean; notes?: string; sortOrder?: number;
    };

    const rows = await db.insert(netWorthAccountsTable).values({
      id: randomUUID(),
      name: body.name,
      institution: body.institution ?? null,
      type: body.type,
      category: body.category,
      currentBalance: String(body.currentBalance ?? 0),
      baseBalance: String(body.baseBalance ?? 0),
      balanceSource: body.balanceSource ?? "manual",
      linkedAccountNumber: body.linkedAccountNumber ?? null,
      linkedAccountName: body.linkedAccountName ?? null,
      isLinked: body.isLinked ?? false,
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 0,
    }).returning();

    res.json(serializeAccount(rows[0]!));
  } catch (err) {
    req.log.error({ err }, "Failed to create net worth account");
    res.status(500).json({ error: "Failed to create net worth account" });
  }
});

// ── Update account ──────────────────────────────────────────────────────────

router.put("/net-worth/accounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as { name?: string; institution?: string; currentBalance?: number; baseBalance?: number; notes?: string; };

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.institution !== undefined) updateData.institution = body.institution;
    if (body.currentBalance !== undefined) updateData.currentBalance = String(body.currentBalance);
    if (body.baseBalance !== undefined) updateData.baseBalance = String(body.baseBalance);
    if (body.notes !== undefined) updateData.notes = body.notes;

    const rows = await db.update(netWorthAccountsTable).set(updateData).where(eq(netWorthAccountsTable.id, id!)).returning();
    if (!rows[0]) return res.status(404).json({ error: "Account not found" });
    res.json(serializeAccount(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to update net worth account");
    res.status(500).json({ error: "Failed to update net worth account" });
  }
});

// ── Delete account ──────────────────────────────────────────────────────────

router.delete("/net-worth/accounts/:id", async (req, res) => {
  try {
    await db.delete(netWorthAccountsTable).where(eq(netWorthAccountsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete net worth account");
    res.status(500).json({ error: "Failed to delete net worth account" });
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

router.get("/net-worth/summary", async (req, res) => {
  try {
    const accounts = await db.select().from(netWorthAccountsTable).orderBy(asc(netWorthAccountsTable.type), asc(netWorthAccountsTable.sortOrder));
    const serialized = accounts.map(serializeAccount);
    const totalAssets = serialized.filter((a) => a.type === "asset").reduce((s, a) => s + a.currentBalance, 0);
    const totalLiabilities = serialized.filter((a) => a.type === "liability").reduce((s, a) => s + a.currentBalance, 0);
    const netWorth = totalAssets - totalLiabilities;

    // Monthly change from most recent snapshot vs previous
    const snapshots = await db.select().from(netWorthSnapshotsTable).orderBy(desc(netWorthSnapshotsTable.snapshotDate)).limit(2);
    let monthlyChange: number | null = null;
    if (snapshots.length >= 2) {
      monthlyChange = netWorth - parseFloat(snapshots[1]!.netWorth);
    }

    res.json({ totalAssets, totalLiabilities, netWorth, monthlyChange, accounts: serialized });
  } catch (err) {
    req.log.error({ err }, "Failed to get net worth summary");
    res.status(500).json({ error: "Failed to get net worth summary" });
  }
});

// ── History ────────────────────────────────────────────────────────────────

router.get("/net-worth/history", async (req, res) => {
  try {
    const snapshots = await db.select().from(netWorthSnapshotsTable).orderBy(asc(netWorthSnapshotsTable.snapshotDate)).limit(60);
    res.json({
      snapshots: snapshots.map((s) => ({
        id: s.id,
        snapshotDate: s.snapshotDate,
        totalAssets: parseFloat(s.totalAssets),
        totalLiabilities: parseFloat(s.totalLiabilities),
        netWorth: parseFloat(s.netWorth),
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get net worth history");
    res.status(500).json({ error: "Failed to get net worth history" });
  }
});

// ── Sync derived balances from transactions ─────────────────────────────────

router.post("/net-worth/sync", async (req, res) => {
  try {
    const count = await syncDerivedBalances(req.log);
    res.json({ synced: count, message: `Synced ${count} linked accounts` });
  } catch (err) {
    req.log.error({ err }, "Failed to sync net worth accounts");
    res.status(500).json({ error: "Failed to sync" });
  }
});

// ── Take snapshot ──────────────────────────────────────────────────────────

router.post("/net-worth/snapshot", async (req, res) => {
  try {
    const snapshot = await takeSnapshot();
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Failed to take snapshot");
    res.status(500).json({ error: "Failed to take snapshot" });
  }
});

// ── Core sync logic (called after import) ─────────────────────────────────

export async function syncNetWorthFromTransactions(log?: any) {
  // 1. Detect all unique accounts from transactions
  const txAccounts = await db
    .select({
      accountNumber: transactionsTable.accountNumber,
      accountName: transactionsTable.accountName,
      providerName: transactionsTable.providerName,
      totalCredits: sql<number>`sum(case when ${transactionsTable.creditDebit} = 'credit' then ${transactionsTable.amount}::numeric else 0 end)`,
      totalDebits: sql<number>`sum(case when ${transactionsTable.creditDebit} = 'debit' then ${transactionsTable.amount}::numeric else 0 end)`,
    })
    .from(transactionsTable)
    .groupBy(transactionsTable.accountNumber, transactionsTable.accountName, transactionsTable.providerName);

  let synced = 0;

  for (const txAcc of txAccounts) {
    if (!txAcc.accountNumber) continue;

    // Net flow from transactions: credits in, debits out
    const netFlow = Number(txAcc.totalCredits) - Number(txAcc.totalDebits);

    // Check if we already have a linked account
    const existing = await db.select().from(netWorthAccountsTable)
      .where(eq(netWorthAccountsTable.linkedAccountNumber, txAcc.accountNumber))
      .limit(1);

    if (existing[0]) {
      // Update the derived balance: baseBalance + netFlow
      const base = parseFloat(existing[0].baseBalance);
      const derivedBalance = base + netFlow;
      await db.update(netWorthAccountsTable)
        .set({ currentBalance: derivedBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(netWorthAccountsTable.id, existing[0].id));
      synced++;
    } else {
      // Create a new linked account — infer type from net flow
      // Positive net flow → asset (bank account / savings)
      // Negative net flow → could be credit card
      const type = netFlow >= 0 ? "asset" : "liability";
      const category = inferCategory(txAcc.accountName ?? "", type);
      const base = 0;
      const derivedBalance = base + netFlow;

      await db.insert(netWorthAccountsTable).values({
        id: randomUUID(),
        name: txAcc.accountName ?? txAcc.accountNumber,
        institution: txAcc.providerName ?? null,
        type,
        category,
        currentBalance: derivedBalance.toFixed(2),
        baseBalance: "0",
        balanceSource: "derived",
        linkedAccountNumber: txAcc.accountNumber,
        linkedAccountName: txAcc.accountName,
        isLinked: true,
        sortOrder: 0,
      });
      synced++;
    }
  }

  // Also update any manually-linked accounts that aren't auto-created
  const linkedAccounts = await db.select().from(netWorthAccountsTable)
    .where(eq(netWorthAccountsTable.isLinked, true));

  for (const acc of linkedAccounts) {
    if (!acc.linkedAccountNumber) continue;
    const txRow = txAccounts.find((t) => t.accountNumber === acc.linkedAccountNumber);
    if (!txRow) continue;
    const netFlow = Number(txRow.totalCredits) - Number(txRow.totalDebits);
    const base = parseFloat(acc.baseBalance);
    const derivedBalance = base + netFlow;
    await db.update(netWorthAccountsTable)
      .set({ currentBalance: derivedBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(netWorthAccountsTable.id, acc.id));
  }

  // Take a snapshot after sync
  await takeSnapshot().catch(() => {});

  return synced;
}

async function syncDerivedBalances(log?: any) {
  return syncNetWorthFromTransactions(log);
}

async function takeSnapshot() {
  const accounts = await db.select().from(netWorthAccountsTable);
  const totalAssets = accounts.filter((a) => a.type === "asset").reduce((s, a) => s + parseFloat(a.currentBalance), 0);
  const totalLiabilities = accounts.filter((a) => a.type === "liability").reduce((s, a) => s + parseFloat(a.currentBalance), 0);
  const netWorth = totalAssets - totalLiabilities;
  const today = new Date().toISOString().substring(0, 10);

  // Upsert today's snapshot
  const existing = await db.select().from(netWorthSnapshotsTable)
    .where(eq(netWorthSnapshotsTable.snapshotDate, today)).limit(1);

  const breakdown = accounts.map((a) => ({ id: a.id, name: a.name, balance: parseFloat(a.currentBalance) }));

  if (existing[0]) {
    const rows = await db.update(netWorthSnapshotsTable)
      .set({ totalAssets: totalAssets.toFixed(2), totalLiabilities: totalLiabilities.toFixed(2), netWorth: netWorth.toFixed(2), breakdown })
      .where(eq(netWorthSnapshotsTable.id, existing[0].id))
      .returning();
    return serializeSnapshot(rows[0]!);
  } else {
    const rows = await db.insert(netWorthSnapshotsTable).values({
      id: randomUUID(),
      snapshotDate: today,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      netWorth: netWorth.toFixed(2),
      breakdown,
    }).returning();
    return serializeSnapshot(rows[0]!);
  }
}

function inferCategory(name: string, type: "asset" | "liability"): string {
  const n = name.toLowerCase();
  if (n.includes("super") || n.includes("retirement")) return "super";
  if (n.includes("saver") || n.includes("savings") || n.includes("term deposit")) return "savings";
  if (n.includes("credit") || n.includes("card") || n.includes("visa") || n.includes("mastercard")) return type === "liability" ? "credit_card" : "bank_account";
  if (n.includes("home loan") || n.includes("mortgage") || n.includes("homeloan")) return "home_loan";
  if (n.includes("car") || n.includes("vehicle") || n.includes("auto")) return type === "liability" ? "car_loan" : "vehicle";
  if (n.includes("personal loan")) return "personal_loan";
  if (n.includes("offset")) return "savings";
  return type === "asset" ? "bank_account" : "other_liability";
}

function serializeAccount(a: typeof netWorthAccountsTable.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    institution: a.institution ?? null,
    type: a.type as "asset" | "liability",
    category: a.category,
    currentBalance: parseFloat(a.currentBalance),
    baseBalance: parseFloat(a.baseBalance),
    balanceSource: a.balanceSource as "derived" | "manual",
    linkedAccountNumber: a.linkedAccountNumber ?? null,
    linkedAccountName: a.linkedAccountName ?? null,
    isLinked: a.isLinked,
    notes: a.notes ?? null,
    sortOrder: a.sortOrder,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeSnapshot(s: typeof netWorthSnapshotsTable.$inferSelect) {
  return {
    id: s.id,
    snapshotDate: s.snapshotDate,
    totalAssets: parseFloat(s.totalAssets),
    totalLiabilities: parseFloat(s.totalLiabilities),
    netWorth: parseFloat(s.netWorth),
    createdAt: s.createdAt.toISOString(),
  };
}

export default router;
