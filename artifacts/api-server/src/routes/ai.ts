import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { SendAiMessageBody } from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router = Router();

router.get("/ai/insights", async (req, res) => {
  try {
    const rows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      categoryName: transactionsTable.categoryName,
      userCategory: transactionsTable.userCategory,
      transactionDate: transactionsTable.transactionDate,
      merchantName: transactionsTable.merchantName,
    }).from(transactionsTable)
      .where(and(eq(transactionsTable.included, true), eq(transactionsTable.isTransfer, false)));

    const monthlyData: Record<string, { income: number; expenses: number }> = {};
    const categoryData: Record<string, number[]> = {};

    for (const row of rows) {
      if (!row.transactionDate || row.isTransfer) continue;
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { income: 0, expenses: 0 };
      const amount = parseFloat(row.amount);
      if (row.creditDebit === "credit") monthlyData[month].income += amount;
      else {
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

    const topCategory = Object.entries(categoryData)
      .map(([cat, amounts]) => ({ cat, total: amounts.reduce((s, a) => s + a, 0) }))
      .sort((a, b) => b.total - a.total)[0];

    const insights = [];

    if (savingsRate > 15 && avgIncome > 0) {
      insights.push({
        id: randomUUID(),
        type: "savings_opportunity" as const,
        title: "SIP increase opportunity",
        message: `Your average savings rate is ${savingsRate.toFixed(1)}%. You can safely increase your monthly SIP by $${Math.round((avgIncome - avgExpenses) * 0.1)} while maintaining a healthy emergency buffer.`,
        impact: Math.round((avgIncome - avgExpenses) * 0.1),
        priority: 1,
      });
    }

    const allExpensesAvg = recentMonths.length > 0 ? avgExpenses : 0;
    insights.push({
      id: randomUUID(),
      type: "spending_pattern" as const,
      title: "True average monthly spend",
      message: `Based on your last ${recentMonths.length} months of data, your true average monthly spend is $${allExpensesAvg.toFixed(0)} — excluding interbank transfers.`,
      impact: null,
      priority: 2,
    });

    if (topCategory) {
      insights.push({
        id: randomUUID(),
        type: "spending_pattern" as const,
        title: `Top spending category: ${topCategory.cat}`,
        message: `${topCategory.cat} is your largest expense category at $${topCategory.total.toFixed(0)} total. This accounts for ${((topCategory.total / (avgExpenses * recentMonths.length || 1)) * 100).toFixed(0)}% of all expenses tracked.`,
        impact: topCategory.total,
        priority: 3,
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
      title: "End of year projection",
      message: `At your current net savings rate of $${(avgIncome - avgExpenses).toFixed(0)}/month, you are on track to accumulate $${Math.round((avgIncome - avgExpenses) * 12).toLocaleString()} by year end.`,
      impact: Math.round((avgIncome - avgExpenses) * 12),
      priority: 4,
    });

    res.json({
      insights: insights.slice(0, 5),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get AI insights");
    res.status(500).json({ error: "Failed to get AI insights" });
  }
});

router.post("/ai/chat", async (req, res) => {
  try {
    const body = SendAiMessageBody.parse(req.body);
    const { message, conversationHistory } = body;

    const rows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      categoryName: transactionsTable.categoryName,
      transactionDate: transactionsTable.transactionDate,
    }).from(transactionsTable)
      .where(and(eq(transactionsTable.included, true)));

    let totalIncome = 0;
    let totalExpenses = 0;
    const monthlyMap: Record<string, { income: number; expenses: number }> = {};

    for (const row of rows) {
      if (row.isTransfer || !row.transactionDate) continue;
      const amount = parseFloat(row.amount);
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { income: 0, expenses: 0 };
      if (row.creditDebit === "credit") {
        totalIncome += amount;
        monthlyMap[month].income += amount;
      } else {
        totalExpenses += amount;
        monthlyMap[month].expenses += amount;
      }
    }

    const months = Object.values(monthlyMap);
    const avgIncome = months.length > 0 ? months.reduce((s, m) => s + m.income, 0) / months.length : 0;
    const avgExpenses = months.length > 0 ? months.reduce((s, m) => s + m.expenses, 0) / months.length : 0;
    const monthlySurplus = avgIncome - avgExpenses;
    const savingsRate = avgIncome > 0 ? ((monthlySurplus / avgIncome) * 100) : 0;

    const systemPrompt = `You are a Personal CFO for a family in Australia. You have access to their real financial data:
- Average monthly income: $${avgIncome.toFixed(0)} AUD
- Average monthly expenses: $${avgExpenses.toFixed(0)} AUD
- Average monthly surplus: $${monthlySurplus.toFixed(0)} AUD
- Savings rate: ${savingsRate.toFixed(1)}%
- Data spans ${months.length} months

You provide clear, decisive, financially sophisticated advice. You are direct and analytical — not generic. 
Always answer based on the real numbers above. When the user asks "can I afford X", calculate it against their surplus.
Keep answers concise but insightful. Use AUD currency. Never hedge unnecessarily.`;

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
