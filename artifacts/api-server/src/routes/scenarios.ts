import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { SimulateScenarioBody } from "@workspace/api-zod";

const router = Router();

router.post("/scenarios/simulate", async (req, res) => {
  try {
    const body = SimulateScenarioBody.parse(req.body);
    const projectionMonths = body.projectionMonths ?? 12;

    const rows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      transactionDate: transactionsTable.transactionDate,
    }).from(transactionsTable)
      .where(and(eq(transactionsTable.included, true), eq(transactionsTable.isTransfer, false)));

    const monthlyMap: Record<string, { income: number; expenses: number }> = {};

    for (const row of rows) {
      if (!row.transactionDate) continue;
      const month = row.transactionDate.substring(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { income: 0, expenses: 0 };
      const amount = parseFloat(row.amount);
      if (row.creditDebit === "credit") monthlyMap[month].income += amount;
      else monthlyMap[month].expenses += amount;
    }

    const months = Object.values(monthlyMap);
    const baseMonthlyIncome = months.length > 0
      ? months.reduce((s, m) => s + m.income, 0) / months.length : 0;
    const baseMonthlyExpenses = months.length > 0
      ? months.reduce((s, m) => s + m.expenses, 0) / months.length : 0;

    let scenarioIncome = baseMonthlyIncome;
    let scenarioExpenses = baseMonthlyExpenses;
    let summaryParts: string[] = [];

    if (body.type === "income_change" && body.incomeChangePercent !== undefined && body.incomeChangePercent !== null) {
      scenarioIncome = baseMonthlyIncome * (1 + body.incomeChangePercent / 100);
      const direction = body.incomeChangePercent >= 0 ? "increase" : "decrease";
      summaryParts.push(`Income ${direction} of ${Math.abs(body.incomeChangePercent)}%`);
    }

    if (body.type === "new_expense" && body.newMonthlyExpense !== undefined && body.newMonthlyExpense !== null) {
      scenarioExpenses = baseMonthlyExpenses + body.newMonthlyExpense;
      summaryParts.push(`New monthly expense of $${body.newMonthlyExpense.toFixed(0)} (${body.expenseLabel ?? "New expense"})`);
    }

    if (body.type === "investment" && body.investmentAmount !== undefined && body.investmentAmount !== null) {
      scenarioExpenses = baseMonthlyExpenses + (body.investmentAmount / 12);
      summaryParts.push(`Investment of $${body.investmentAmount.toLocaleString()} spread over 12 months`);
    }

    if (body.type === "debt_payoff" && body.debtAmount !== undefined && body.debtAmount !== null) {
      const rate = (body.debtInterestRate ?? 5) / 100 / 12;
      const term = 60;
      const monthlyPayment = rate > 0
        ? body.debtAmount * rate / (1 - Math.pow(1 + rate, -term))
        : body.debtAmount / term;
      scenarioExpenses = baseMonthlyExpenses + monthlyPayment;
      summaryParts.push(`Debt repayment: $${monthlyPayment.toFixed(0)}/month for $${body.debtAmount.toLocaleString()} loan`);
    }

    if (body.type === "holiday" && body.holidayBudget !== undefined && body.holidayBudget !== null) {
      scenarioExpenses = baseMonthlyExpenses + (body.holidayBudget / projectionMonths);
      summaryParts.push(`Holiday budget of $${body.holidayBudget.toLocaleString()} spread over ${projectionMonths} months`);
    }

    const currentMonthlySurplus = baseMonthlyIncome - baseMonthlyExpenses;
    const scenarioMonthlySurplus = scenarioIncome - scenarioExpenses;
    const currentSavingsRate = baseMonthlyIncome > 0 ? (currentMonthlySurplus / baseMonthlyIncome) * 100 : 0;
    const newSavingsRate = scenarioIncome > 0 ? (scenarioMonthlySurplus / scenarioIncome) * 100 : 0;
    const cashflowImpact = scenarioMonthlySurplus - currentMonthlySurplus;

    const runwayCurrent = currentMonthlySurplus > 0 ? 999 : Math.abs(baseMonthlyIncome / currentMonthlySurplus);
    const runwayNew = scenarioMonthlySurplus > 0 ? 999 : Math.abs(scenarioIncome / scenarioMonthlySurplus);

    const monthlyProjection = [];
    let cumulativeSavings = 0;
    const startDate = new Date();

    for (let i = 0; i < projectionMonths; i++) {
      const projDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const monthLabel = projDate.toISOString().substring(0, 7);
      const savings = scenarioMonthlySurplus;
      cumulativeSavings += savings;
      monthlyProjection.push({
        month: monthLabel,
        income: scenarioIncome,
        expenses: scenarioExpenses,
        savings,
        cumulativeSavings,
      });
    }

    const summary = summaryParts.length > 0
      ? `Simulating: ${summaryParts.join(", ")}. Monthly cashflow impact: ${cashflowImpact >= 0 ? "+" : ""}$${cashflowImpact.toFixed(0)}.`
      : "Baseline scenario with no changes applied.";

    res.json({
      summary,
      currentSavingsRate,
      newSavingsRate,
      monthlyCashflowImpact: cashflowImpact,
      runwayMonthsCurrent: Math.min(runwayCurrent, 999),
      runwayMonthsNew: Math.min(runwayNew, 999),
      monthlyProjection,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to simulate scenario");
    res.status(500).json({ error: "Failed to simulate scenario" });
  }
});

export default router;
