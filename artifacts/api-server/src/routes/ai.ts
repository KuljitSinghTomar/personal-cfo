import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { SendAiMessageBody } from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router = Router();

// ── Shared: detect fund type from description / category ─────────────────────
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
  { name: "CommSec", patterns: ["commsec"], type: "shares" },
  { name: "Pearler", patterns: ["pearler"], type: "shares" },
  { name: "Raiz", patterns: ["raiz"], type: "shares" },
  { name: "Spaceship", patterns: ["spaceship"], type: "shares" },
  { name: "Stake", patterns: ["stake"], type: "shares" },
  { name: "Superhero", patterns: ["superhero"], type: "shares" },
  { name: "nabtrade", patterns: ["nabtrade"], type: "shares" },
];

function detectFundType(description: string, category: string | null): "super" | "shares" {
  const d = description.toLowerCase();
  const c = (category ?? "").toLowerCase();
  for (const f of FUND_PATTERNS) {
    if (f.patterns.some((p) => d.includes(p) || c.includes(p))) return f.type;
  }
  if (c.includes("super")) return "super";
  return "shares";
}

// ── Fetch investment summary from DB ─────────────────────────────────────────
async function getInvestmentSummary() {
  const rows = await db
    .select({
      amount: transactionsTable.amount,
      transactionDate: transactionsTable.transactionDate,
      description: transactionsTable.description,
      categoryName: transactionsTable.categoryName,
      userCategory: transactionsTable.userCategory,
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

  if (rows.length === 0) return null;

  let totalInvested = 0;
  let superTotal = 0;
  let sharesTotal = 0;
  const fundMap: Record<string, number> = {};
  const monthlyMap: Record<string, number> = {};

  for (const row of rows) {
    const amount = parseFloat(row.amount);
    totalInvested += amount;
    const type = detectFundType(row.description, row.userCategory ?? row.categoryName);
    if (type === "super") superTotal += amount;
    else sharesTotal += amount;

    // Track by fund description (simplified)
    const fundKey = row.userCategory ?? row.categoryName ?? "Other";
    fundMap[fundKey] = (fundMap[fundKey] ?? 0) + amount;

    if (row.transactionDate) {
      const month = row.transactionDate.substring(0, 7);
      monthlyMap[month] = (monthlyMap[month] ?? 0) + amount;
    }
  }

  const monthlyValues = Object.values(monthlyMap);
  const avgMonthly = monthlyValues.length > 0
    ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length
    : 0;

  const topFunds = Object.entries(fundMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount]) => ({ name, amount }));

  return {
    totalInvested,
    superTotal,
    sharesTotal,
    avgMonthly,
    contributionCount: rows.length,
    topFunds,
    monthCount: monthlyValues.length,
  };
}

// ── GET /api/ai/insights ──────────────────────────────────────────────────────

router.get("/ai/insights", async (req, res) => {
  try {
    const [rows, investmentSummary] = await Promise.all([
      db.select({
        amount: transactionsTable.amount,
        creditDebit: transactionsTable.creditDebit,
        isTransfer: transactionsTable.isTransfer,
        isInvestment: transactionsTable.isInvestment,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
        transactionDate: transactionsTable.transactionDate,
      }).from(transactionsTable)
        .where(and(eq(transactionsTable.included, true), eq(transactionsTable.isTransfer, false))),
      getInvestmentSummary(),
    ]);

    const monthlyData: Record<string, { income: number; expenses: number }> = {};
    const categoryData: Record<string, number[]> = {};

    for (const row of rows) {
      if (!row.transactionDate || row.isTransfer) continue;
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { income: 0, expenses: 0 };
      const amount = parseFloat(row.amount);
      if (row.creditDebit === "credit") {
        monthlyData[month].income += amount;
      } else if (!row.isInvestment) {
        monthlyData[month].expenses += amount;
        const cat = row.userCategory ?? row.categoryName ?? "Uncategorised";
        if (!categoryData[cat]) categoryData[cat] = [];
        categoryData[cat].push(amount);
      }
    }

    const months = Object.keys(monthlyData).sort().slice(-6);
    const recentMonths = months.map(m => monthlyData[m]);
    const avgIncome = recentMonths.length > 0 ? recentMonths.reduce((s, m) => s + m.income, 0) / recentMonths.length : 0;
    const avgExpenses = recentMonths.length > 0 ? recentMonths.reduce((s, m) => s + m.expenses, 0) / recentMonths.length : 0;
    const savingsRate = avgIncome > 0 ? ((avgIncome - avgExpenses) / avgIncome) * 100 : 0;
    const investmentRate = avgIncome > 0 && investmentSummary
      ? (investmentSummary.avgMonthly / avgIncome) * 100
      : 0;

    const topCategory = Object.entries(categoryData)
      .map(([cat, amounts]) => ({ cat, total: amounts.reduce((s, a) => s + a, 0) }))
      .sort((a, b) => b.total - a.total)[0];

    const insights = [];

    // Investment insight — highest priority if we have data
    if (investmentSummary && investmentSummary.totalInvested > 0) {
      const superPct = investmentSummary.totalInvested > 0
        ? ((investmentSummary.superTotal / investmentSummary.totalInvested) * 100).toFixed(0)
        : 0;
      insights.push({
        id: randomUUID(),
        type: "forecast" as const,
        title: `Investing $${Math.round(investmentSummary.avgMonthly).toLocaleString()}/month`,
        message: `You are putting ${investmentRate.toFixed(1)}% of your income into investments — $${Math.round(investmentSummary.avgMonthly).toLocaleString()}/month on average. ${superPct}% is super. Total contributed to date: $${Math.round(investmentSummary.totalInvested).toLocaleString()}.`,
        impact: Math.round(investmentSummary.avgMonthly * 12),
        priority: 1,
      });

      // Super concentration check
      if (investmentSummary.superTotal > investmentSummary.sharesTotal * 3 && investmentSummary.sharesTotal > 0) {
        insights.push({
          id: randomUUID(),
          type: "spending_pattern" as const,
          title: "Portfolio is super-heavy",
          message: `${((investmentSummary.superTotal / investmentSummary.totalInvested) * 100).toFixed(0)}% of your investments are in super — consider whether your outside-super allocation (shares/ETFs at $${Math.round(investmentSummary.sharesTotal).toLocaleString()}) matches your liquidity needs before retirement age.`,
          impact: null,
          priority: 2,
        });
      }
    }

    if (savingsRate > 15 && avgIncome > 0) {
      insights.push({
        id: randomUUID(),
        type: "savings_opportunity" as const,
        title: "Strong savings runway",
        message: `Your net savings rate is ${savingsRate.toFixed(1)}%. After investments, your effective surplus is $${Math.round(avgIncome - avgExpenses - (investmentSummary?.avgMonthly ?? 0))}/month — well-positioned for goal funding.`,
        impact: Math.round((avgIncome - avgExpenses) * 0.1),
        priority: 3,
      });
    }

    insights.push({
      id: randomUUID(),
      type: "spending_pattern" as const,
      title: "True average monthly spend",
      message: `Based on your last ${recentMonths.length} months of data, your true average monthly spend (excluding investments and transfers) is $${avgExpenses.toFixed(0)}.`,
      impact: null,
      priority: 4,
    });

    if (topCategory) {
      insights.push({
        id: randomUUID(),
        type: "spending_pattern" as const,
        title: `Top spending category: ${topCategory.cat}`,
        message: `${topCategory.cat} is your largest expense category at $${topCategory.total.toFixed(0)} total — ${((topCategory.total / (avgExpenses * recentMonths.length || 1)) * 100).toFixed(0)}% of all tracked expenses.`,
        impact: topCategory.total,
        priority: 5,
      });
    }

    if (savingsRate < 10 && avgIncome > 0) {
      insights.push({
        id: randomUUID(),
        type: "warning" as const,
        title: "Low savings rate alert",
        message: `Your savings rate of ${savingsRate.toFixed(1)}% is below the recommended 20%. Consider reviewing discretionary spending to improve your financial position.`,
        impact: Math.round(avgIncome * 0.2 - (avgIncome - avgExpenses)),
        priority: 1,
      });
    }

    insights.push({
      id: randomUUID(),
      type: "forecast" as const,
      title: "End-of-year projection",
      message: `At your current net savings rate of $${(avgIncome - avgExpenses).toFixed(0)}/month, you will accumulate $${Math.round((avgIncome - avgExpenses) * 12).toLocaleString()} in savings by year end — on top of $${Math.round((investmentSummary?.avgMonthly ?? 0) * 12).toLocaleString()} in new investments.`,
      impact: Math.round((avgIncome - avgExpenses) * 12),
      priority: 6,
    });

    res.json({
      insights: insights.sort((a, b) => a.priority - b.priority).slice(0, 5),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get AI insights");
    res.status(500).json({ error: "Failed to get AI insights" });
  }
});

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────

router.post("/ai/chat", async (req, res) => {
  try {
    const body = SendAiMessageBody.parse(req.body);
    const { message, conversationHistory } = body;

    // Fetch cash flow data and investment data in parallel
    const [rows, investmentSummary] = await Promise.all([
      db.select({
        amount: transactionsTable.amount,
        creditDebit: transactionsTable.creditDebit,
        isTransfer: transactionsTable.isTransfer,
        isInvestment: transactionsTable.isInvestment,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
        transactionDate: transactionsTable.transactionDate,
      }).from(transactionsTable)
        .where(and(eq(transactionsTable.included, true))),
      getInvestmentSummary(),
    ]);

    let totalIncome = 0;
    let totalExpenses = 0;
    const monthlyMap: Record<string, { income: number; expenses: number }> = {};
    const categoryTotals: Record<string, number> = {};

    for (const row of rows) {
      if (row.isTransfer || !row.transactionDate) continue;
      const amount = parseFloat(row.amount);
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { income: 0, expenses: 0 };

      if (row.creditDebit === "credit") {
        totalIncome += amount;
        monthlyMap[month].income += amount;
      } else if (!row.isInvestment) {
        totalExpenses += amount;
        monthlyMap[month].expenses += amount;
        const cat = row.userCategory ?? row.categoryName ?? "Uncategorised";
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;
      }
    }

    const months = Object.values(monthlyMap);
    const avgIncome = months.length > 0 ? months.reduce((s, m) => s + m.income, 0) / months.length : 0;
    const avgExpenses = months.length > 0 ? months.reduce((s, m) => s + m.expenses, 0) / months.length : 0;
    const monthlySurplus = avgIncome - avgExpenses - (investmentSummary?.avgMonthly ?? 0);
    const savingsRate = avgIncome > 0 ? ((avgIncome - avgExpenses) / avgIncome) * 100 : 0;
    const investmentRate = avgIncome > 0 && investmentSummary
      ? (investmentSummary.avgMonthly / avgIncome) * 100
      : 0;

    // Top 5 spending categories
    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, total]) => `  - ${cat}: $${Math.round(total).toLocaleString()}`)
      .join("\n");

    // Investment section of prompt
    let investmentSection = "- No investment transactions detected yet.";
    if (investmentSummary && investmentSummary.totalInvested > 0) {
      const superPct = ((investmentSummary.superTotal / investmentSummary.totalInvested) * 100).toFixed(0);
      const sharesPct = ((investmentSummary.sharesTotal / investmentSummary.totalInvested) * 100).toFixed(0);
      const fundLines = investmentSummary.topFunds
        .map(f => `  - ${f.name}: $${Math.round(f.amount).toLocaleString()}`)
        .join("\n");
      investmentSection = `- Total invested (all time): $${Math.round(investmentSummary.totalInvested).toLocaleString()} AUD across ${investmentSummary.contributionCount} contributions
- Super contributions: $${Math.round(investmentSummary.superTotal).toLocaleString()} (${superPct}% of portfolio)
- Shares / ETFs: $${Math.round(investmentSummary.sharesTotal).toLocaleString()} (${sharesPct}% of portfolio)
- Average monthly investment: $${Math.round(investmentSummary.avgMonthly).toLocaleString()} (${investmentRate.toFixed(1)}% of income)
- Investment categories tracked:
${fundLines}`;
    }

    const systemPrompt = `You are a Personal CFO for an Australian family. You have access to their real financial data and must use it to give specific, numbers-driven advice.

## Cash Flow (monthly averages over ${months.length} months)
- Average monthly income: $${Math.round(avgIncome).toLocaleString()} AUD
- Average monthly expenses (excl. investments): $${Math.round(avgExpenses).toLocaleString()} AUD
- Average monthly investments: $${Math.round(investmentSummary?.avgMonthly ?? 0).toLocaleString()} AUD
- True monthly surplus (after all outgoings + investments): $${Math.round(monthlySurplus).toLocaleString()} AUD
- Savings rate (income minus expenses): ${savingsRate.toFixed(1)}%
- Investment rate (investments as % of income): ${investmentRate.toFixed(1)}%

## Top Spending Categories (all time)
${topCategories || "  - No category data available"}

## Investment Portfolio
${investmentSection}

## Advice Guidelines
- Be direct, specific and analytical — use the real numbers above, not generic rules
- When asked "can I afford X", calculate it against the true monthly surplus of $${Math.round(monthlySurplus).toLocaleString()}
- When asked about super, reference their actual super balance and contribution rate
- When asked about investment diversification, comment on their super vs shares split
- Factor in that super is locked until preservation age (~60) when discussing liquidity
- All currency in AUD. No unnecessary hedging. Keep answers concise but insightful.`;

    const chatMessages = [
      ...conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed AI chat");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process AI chat" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

export default router;
