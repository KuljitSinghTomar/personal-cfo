import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, ne } from "drizzle-orm";
import { GetDashboardSummaryQueryParams, GetCashflowQueryParams, GetSpendingByCategoryQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const query = GetDashboardSummaryQueryParams.parse(req.query);
    const { startDate, endDate } = query;

    const conditions = [eq(transactionsTable.included, true)];
    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));

    const rows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      isInvestment: transactionsTable.isInvestment,
      categoryName: transactionsTable.categoryName,
      userCategory: transactionsTable.userCategory,
    }).from(transactionsTable).where(and(...conditions));

    let totalIncome = 0;
    let totalExpenses = 0;
    let totalInvested = 0;
    let transfersFiltered = 0;
    let investmentsFiltered = 0;

    const categoryTotals: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const investCategoryTotals: Record<string, number> = {};
    const investCategoryCounts: Record<string, number> = {};

    for (const row of rows) {
      const amount = parseFloat(row.amount);
      if (row.isTransfer) {
        transfersFiltered++;
        continue;
      }
      // Investments: debit transactions flagged as investments — their own bucket
      if (row.isInvestment && row.creditDebit === "debit") {
        investmentsFiltered++;
        totalInvested += amount;
        const cat = row.userCategory ?? row.categoryName ?? "Investments";
        investCategoryTotals[cat] = (investCategoryTotals[cat] ?? 0) + amount;
        investCategoryCounts[cat] = (investCategoryCounts[cat] ?? 0) + 1;
        continue;
      }
      const category = row.userCategory ?? row.categoryName ?? "Uncategorised";
      if (row.creditDebit === "credit") {
        totalIncome += amount;
      } else {
        totalExpenses += amount;
        categoryTotals[category] = (categoryTotals[category] ?? 0) + amount;
        categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
      }
    }

    const netCashflow = totalIncome - totalExpenses - totalInvested;
    const savingsRate = totalIncome > 0 ? ((netCashflow / totalIncome) * 100) : 0;

    const topCategories = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        count: categoryCounts[category] ?? 0,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const topInvestmentCategories = Object.entries(investCategoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        count: investCategoryCounts[category] ?? 0,
        percentage: totalInvested > 0 ? (amount / totalInvested) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const periodLabel = startDate && endDate
      ? `${startDate} to ${endDate}`
      : `Last 12 months`;

    res.json({
      totalIncome,
      totalExpenses,
      totalInvested,
      netCashflow,
      savingsRate,
      transfersFiltered,
      investmentsFiltered,
      transactionCount: rows.length,
      periodLabel,
      topCategories,
      topInvestmentCategories,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Failed to get dashboard summary" });
  }
});

router.get("/dashboard/cashflow", async (req, res) => {
  try {
    const query = GetCashflowQueryParams.parse(req.query);
    const months = query.months ?? 12;
    const startDate = query.startDate;
    const endDate = query.endDate;

    const conditions = [eq(transactionsTable.included, true)];
    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));

    const rows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      isInvestment: transactionsTable.isInvestment,
      transactionDate: transactionsTable.transactionDate,
    }).from(transactionsTable)
      .where(and(...conditions));

    const monthlyMap: Record<string, { income: number; expenses: number; investments: number; transfers: number }> = {};

    for (const row of rows) {
      if (!row.transactionDate) continue;
      const monthKey = row.transactionDate.substring(0, 7);
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { income: 0, expenses: 0, investments: 0, transfers: 0 };
      }
      const amount = parseFloat(row.amount);
      if (row.isTransfer) {
        monthlyMap[monthKey].transfers += amount;
        continue;
      }
      if (row.isInvestment && row.creditDebit === "debit") {
        monthlyMap[monthKey].investments += amount;
        continue;
      }
      if (row.creditDebit === "credit") {
        monthlyMap[monthKey].income += amount;
      } else {
        monthlyMap[monthKey].expenses += amount;
      }
    }

    // When explicit date range is set, use all months in range; otherwise use last N months
    const sortedMonths = (startDate || endDate)
      ? Object.keys(monthlyMap).sort()
      : Object.keys(monthlyMap).sort().slice(-months);

    const monthsData = sortedMonths.map((month) => {
      const data = monthlyMap[month];
      return {
        month,
        income: data.income,
        expenses: data.expenses,
        investments: data.investments,
        savings: data.income - data.expenses - data.investments,
        transfers: data.transfers,
      };
    });

    const avgIncome = monthsData.length > 0 ? monthsData.reduce((s, m) => s + m.income, 0) / monthsData.length : 0;
    const avgExpenses = monthsData.length > 0 ? monthsData.reduce((s, m) => s + m.expenses, 0) / monthsData.length : 0;
    const avgSavings = avgIncome - avgExpenses;

    res.json({
      months: monthsData,
      averageIncome: avgIncome,
      averageExpenses: avgExpenses,
      averageSavings: avgSavings,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get cashflow");
    res.status(500).json({ error: "Failed to get cashflow" });
  }
});

router.get("/dashboard/spending-by-category", async (req, res) => {
  try {
    const query = GetSpendingByCategoryQueryParams.parse(req.query);
    const { startDate, endDate } = query;

    const conditions = [
      eq(transactionsTable.included, true),
      eq(transactionsTable.creditDebit, "debit"),
      eq(transactionsTable.isTransfer, false),
      eq(transactionsTable.isInvestment, false),
    ];
    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));

    const rows = await db.select({
      amount: transactionsTable.amount,
      categoryName: transactionsTable.categoryName,
      userCategory: transactionsTable.userCategory,
    }).from(transactionsTable).where(and(...conditions));

    const categoryTotals: Record<string, { amount: number; count: number }> = {};
    let totalSpend = 0;

    for (const row of rows) {
      const category = row.userCategory ?? row.categoryName ?? "Uncategorised";
      const amount = parseFloat(row.amount);
      totalSpend += amount;
      if (!categoryTotals[category]) categoryTotals[category] = { amount: 0, count: 0 };
      categoryTotals[category].amount += amount;
      categoryTotals[category].count++;
    }

    const categories = Object.entries(categoryTotals)
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count,
        percentage: totalSpend > 0 ? (data.amount / totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({ categories, totalSpend });
  } catch (err) {
    req.log.error({ err }, "Failed to get spending by category");
    res.status(500).json({ error: "Failed to get spending by category" });
  }
});

router.get("/dashboard/accounts", async (req, res) => {
  try {
    const rows = await db.select({
      accountName: transactionsTable.accountName,
      accountNumber: transactionsTable.accountNumber,
      providerName: transactionsTable.providerName,
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      transactionDate: transactionsTable.transactionDate,
    }).from(transactionsTable)
      .where(eq(transactionsTable.included, true));

    const accountMap: Record<string, {
      accountName: string;
      accountNumber: string;
      providerName: string;
      totalCredits: number;
      totalDebits: number;
      count: number;
      lastActivity: string;
    }> = {};

    for (const row of rows) {
      const key = row.accountNumber;
      if (!accountMap[key]) {
        accountMap[key] = {
          accountName: row.accountName,
          accountNumber: row.accountNumber,
          providerName: row.providerName,
          totalCredits: 0,
          totalDebits: 0,
          count: 0,
          lastActivity: row.transactionDate ?? "",
        };
      }
      const amount = parseFloat(row.amount);
      if (row.creditDebit === "credit") accountMap[key].totalCredits += amount;
      else accountMap[key].totalDebits += amount;
      accountMap[key].count++;
      if ((row.transactionDate ?? "") > accountMap[key].lastActivity) {
        accountMap[key].lastActivity = row.transactionDate ?? "";
      }
    }

    const accounts = Object.values(accountMap).map((a) => ({
      accountName: a.accountName,
      accountNumber: a.accountNumber,
      providerName: a.providerName,
      totalCredits: a.totalCredits,
      totalDebits: a.totalDebits,
      transactionCount: a.count,
      lastActivity: a.lastActivity,
    })).sort((a, b) => b.totalCredits - a.totalCredits);

    res.json({ accounts });
  } catch (err) {
    req.log.error({ err }, "Failed to get accounts");
    res.status(500).json({ error: "Failed to get accounts" });
  }
});

router.get("/dashboard/category-drilldown", async (req, res) => {
  try {
    const type = (req.query.type as string) === "income" ? "income" : "expenses";
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const creditDebit = type === "income" ? "credit" : "debit";

    const conditions = [
      eq(transactionsTable.included, true),
      eq(transactionsTable.creditDebit, creditDebit),
      eq(transactionsTable.isTransfer, false),
      eq(transactionsTable.isInvestment, false),
    ];
    if (startDate) conditions.push(gte(transactionsTable.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactionsTable.transactionDate, endDate));

    const rows = await db
      .select({
        amount: transactionsTable.amount,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
      })
      .from(transactionsTable)
      .where(and(...conditions));

    const categoryTotals: Record<string, { amount: number; count: number }> = {};
    let total = 0;

    for (const row of rows) {
      const category = row.userCategory ?? row.categoryName ?? "Uncategorised";
      const amount = parseFloat(row.amount);
      total += amount;
      if (!categoryTotals[category]) categoryTotals[category] = { amount: 0, count: 0 };
      categoryTotals[category].amount += amount;
      categoryTotals[category].count++;
    }

    const categories = Object.entries(categoryTotals)
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count,
        percentage: total > 0 ? (data.amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({ type, categories, total });
  } catch (err) {
    req.log.error({ err }, "Failed to get category drilldown");
    res.status(500).json({ error: "Failed to get category drilldown" });
  }
});

router.get("/dashboard/forecast", async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.toISOString().substring(0, 7);
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const allRows = await db.select({
      amount: transactionsTable.amount,
      creditDebit: transactionsTable.creditDebit,
      isTransfer: transactionsTable.isTransfer,
      isInvestment: transactionsTable.isInvestment,
      transactionDate: transactionsTable.transactionDate,
    }).from(transactionsTable)
      .where(and(eq(transactionsTable.included, true), eq(transactionsTable.isTransfer, false)));

    // Exclude investments from expense forecasting (they aren't variable spending)
    const spendRows = allRows.filter(r => !r.isInvestment || r.creditDebit === "credit");

    const currentMonthRows = spendRows.filter(r => r.transactionDate?.startsWith(currentMonth));
    const historicalRows = spendRows.filter(r => !r.transactionDate?.startsWith(currentMonth));

    let currentMonthSpend = 0;
    let currentMonthIncome = 0;
    for (const r of currentMonthRows) {
      const amount = parseFloat(r.amount);
      if (r.creditDebit === "debit") currentMonthSpend += amount;
      else currentMonthIncome += amount;
    }

    const monthlyIncomes: Record<string, number> = {};
    for (const r of historicalRows) {
      if (!r.transactionDate || r.creditDebit !== "credit") continue;
      const month = r.transactionDate.substring(0, 7);
      monthlyIncomes[month] = (monthlyIncomes[month] ?? 0) + parseFloat(r.amount);
    }
    const incomeValues = Object.values(monthlyIncomes);
    const avgMonthlyIncome = incomeValues.length > 0
      ? incomeValues.reduce((s, v) => s + v, 0) / incomeValues.length
      : currentMonthIncome;

    const monthlyExpenses: Record<string, number> = {};
    for (const r of historicalRows) {
      if (!r.transactionDate || r.creditDebit !== "debit") continue;
      const month = r.transactionDate.substring(0, 7);
      monthlyExpenses[month] = (monthlyExpenses[month] ?? 0) + parseFloat(r.amount);
    }
    const expenseValues = Object.values(monthlyExpenses);
    const avgMonthlyExpense = expenseValues.length > 0
      ? expenseValues.reduce((s, v) => s + v, 0) / expenseValues.length
      : currentMonthSpend;

    // Use the greater of current-month-rate or historical average for projection
    const dailySpendRate = dayOfMonth > 0 ? Math.max(currentMonthSpend / dayOfMonth, avgMonthlyExpense / daysInMonth) : avgMonthlyExpense / daysInMonth;
    const projectedMonthSpend = currentMonthSpend + dailySpendRate * daysRemaining;
    const projectedSavings = avgMonthlyIncome - projectedMonthSpend;

    const surplusCurrentMonth = avgMonthlyIncome - projectedMonthSpend;
    let onTrackMessage: string;
    if (surplusCurrentMonth > 0) {
      onTrackMessage = `At this rate, you will save $${surplusCurrentMonth.toFixed(0)} by end of month`;
    } else {
      onTrackMessage = `At this rate, you will overspend by $${Math.abs(surplusCurrentMonth).toFixed(0)} this month`;
    }

    const monthlySurplus = avgMonthlyIncome - avgMonthlyExpense;
    const runwayMonths = monthlySurplus > 0 ? 999 : (avgMonthlyIncome > 0 ? avgMonthlyIncome / Math.abs(monthlySurplus) : 0);

    res.json({
      currentMonthSpend,
      projectedMonthSpend,
      projectedSavings,
      averageMonthlyIncome: avgMonthlyIncome,
      daysRemainingInMonth: daysRemaining,
      onTrackMessage,
      runwayMonths: Math.min(runwayMonths, 999),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get forecast");
    res.status(500).json({ error: "Failed to get forecast" });
  }
});

export default router;
