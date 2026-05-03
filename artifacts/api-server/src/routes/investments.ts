import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, ilike, or, desc } from "drizzle-orm";

const router = Router();

// ── Investment portfolio summary ───────────────────────────────────────────

router.get("/investments/portfolio", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: transactionsTable.id,
        description: transactionsTable.description,
        userDescription: transactionsTable.userDescription,
        amount: transactionsTable.amount,
        transactionDate: transactionsTable.transactionDate,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
        accountName: transactionsTable.accountName,
        providerName: transactionsTable.providerName,
        creditDebit: transactionsTable.creditDebit,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.isInvestment, true),
          eq(transactionsTable.included, true),
          eq(transactionsTable.creditDebit, "debit"),
        )
      )
      .orderBy(desc(transactionsTable.transactionDate));

    const totalInvested = rows.reduce((s, r) => s + parseFloat(r.amount), 0);

    // ── Fund breakdown ────────────────────────────────────────────────────
    const FUND_PATTERNS: { name: string; patterns: string[]; type: "super" | "shares" }[] = [
      { name: "HostPlus", patterns: ["hostplus", "host plus"], type: "super" },
      { name: "AustralianSuper", patterns: ["australiansuper", "australian super"], type: "super" },
      { name: "UniSuper", patterns: ["unisuper"], type: "super" },
      { name: "REST Super", patterns: ["rest super"], type: "super" },
      { name: "CBUS", patterns: ["cbus super", "cbus"], type: "super" },
      { name: "HESTA", patterns: ["hesta"], type: "super" },
      { name: "Vanguard", patterns: ["vanguard"], type: "shares" },
      { name: "BetaShares", patterns: ["betashares"], type: "shares" },
      { name: "iShares", patterns: ["ishares"], type: "shares" },
      { name: "Magellan", patterns: ["magellan"], type: "shares" },
      { name: "Argo Investments", patterns: ["argo invest"], type: "shares" },
      { name: "AFIC", patterns: ["afic"], type: "shares" },
      { name: "CommSec", patterns: ["commsec"], type: "shares" },
      { name: "Pearler", patterns: ["pearler"], type: "shares" },
      { name: "SelfWealth", patterns: ["selfwealth"], type: "shares" },
      { name: "Raiz", patterns: ["raiz"], type: "shares" },
      { name: "Spaceship", patterns: ["spaceship"], type: "shares" },
      { name: "nabtrade", patterns: ["nabtrade"], type: "shares" },
      { name: "Stake", patterns: ["stake"], type: "shares" },
      { name: "Superhero", patterns: ["superhero"], type: "shares" },
    ];

    function detectFund(description: string, categoryName: string | null): { name: string; type: "super" | "shares" } {
      const desc = description.toLowerCase();
      const cat = (categoryName ?? "").toLowerCase();
      for (const fund of FUND_PATTERNS) {
        if (fund.patterns.some((p) => desc.includes(p) || cat.includes(p))) {
          return { name: fund.name, type: fund.type };
        }
      }
      // Category-based fallback
      if (cat.includes("super")) return { name: "Super (Other)", type: "super" };
      if (cat.includes("invest") || cat.includes("shares") || cat.includes("brokerage") || cat.includes("etf")) {
        return { name: "Shares / ETFs", type: "shares" };
      }
      return { name: "Other Investments", type: "shares" };
    }

    const fundMap: Record<string, { amount: number; count: number; lastDate: string; type: "super" | "shares" }> = {};

    for (const row of rows) {
      const detected = detectFund(row.description, row.userCategory ?? row.categoryName);
      const fund = detected.name;
      const type = detected.type;
      const amount = parseFloat(row.amount);
      if (!fundMap[fund]) {
        fundMap[fund] = { amount: 0, count: 0, lastDate: row.transactionDate ?? "", type };
      }
      fundMap[fund].amount += amount;
      fundMap[fund].count++;
      if ((row.transactionDate ?? "") > fundMap[fund].lastDate) {
        fundMap[fund].lastDate = row.transactionDate ?? "";
      }
    }

    const funds = Object.entries(fundMap)
      .map(([name, data]) => ({
        name,
        amount: data.amount,
        count: data.count,
        lastContribution: data.lastDate,
        type: data.type,
        percentage: totalInvested > 0 ? (data.amount / totalInvested) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // ── Monthly contribution history (last 18 months) ────────────────────
    const monthlyMap: Record<string, { total: number; superAmt: number; sharesAmt: number }> = {};

    for (const row of rows) {
      if (!row.transactionDate) continue;
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { total: 0, superAmt: 0, sharesAmt: 0 };
      const amount = parseFloat(row.amount);
      const { type: txType } = detectFund(row.description, row.userCategory ?? row.categoryName);
      monthlyMap[month].total += amount;
      if (txType === "super") monthlyMap[month].superAmt += amount;
      else monthlyMap[month].sharesAmt += amount;
    }

    const monthlyHistory = Object.keys(monthlyMap)
      .sort()
      .slice(-18)
      .map((month) => ({
        month,
        total: monthlyMap[month].total,
        superAmt: monthlyMap[month].superAmt,
        sharesAmt: monthlyMap[month].sharesAmt,
      }));

    // ── Type split (super vs shares) — derived from fund map ─────────────
    const superTotal = funds.filter((f) => f.type === "super").reduce((s, f) => s + f.amount, 0);
    const sharesTotal = funds.filter((f) => f.type === "shares").reduce((s, f) => s + f.amount, 0);

    // ── Average monthly contribution ─────────────────────────────────────
    const avgMonthly = monthlyHistory.length > 0
      ? monthlyHistory.reduce((s, m) => s + m.total, 0) / monthlyHistory.length
      : 0;

    res.json({
      totalInvested,
      superTotal,
      sharesTotal,
      avgMonthly,
      transactionCount: rows.length,
      funds,
      monthlyHistory,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get investment portfolio");
    res.status(500).json({ error: "Failed to get investment portfolio" });
  }
});

export default router;
