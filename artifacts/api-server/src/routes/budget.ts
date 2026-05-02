import { Router } from "express";
import { db } from "@workspace/db";
import { budgetGoalsTable, transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, ilike, sql, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  CreateBudgetGoalBody,
  DeleteBudgetGoalParams,
  UpdateBudgetGoalParams,
  UpdateBudgetGoalBody,
} from "@workspace/api-zod";

const router = Router();

// ── List goals ─────────────────────────────────────────────────────────────

router.get("/budget/goals", async (req, res) => {
  try {
    const goals = await db.select().from(budgetGoalsTable).orderBy(budgetGoalsTable.category);
    res.json({ goals: goals.map(serializeGoal) });
  } catch (err) {
    req.log.error({ err }, "Failed to list budget goals");
    res.status(500).json({ error: "Failed to list budget goals" });
  }
});

// ── Create/upsert goal (manual) ────────────────────────────────────────────

router.post("/budget/goals", async (req, res) => {
  try {
    const body = CreateBudgetGoalBody.parse(req.body);

    const existing = await db.select().from(budgetGoalsTable)
      .where(ilike(budgetGoalsTable.category, body.category))
      .limit(1);

    let goal;
    if (existing[0]) {
      const rows = await db.update(budgetGoalsTable)
        .set({
          monthlyLimit: body.monthlyLimit.toFixed(2),
          source: "manual",
          userEdited: true,
          updatedAt: new Date(),
        })
        .where(eq(budgetGoalsTable.id, existing[0].id))
        .returning();
      goal = rows[0];
    } else {
      const rows = await db.insert(budgetGoalsTable).values({
        id: randomUUID(),
        category: body.category,
        monthlyLimit: body.monthlyLimit.toFixed(2),
        source: "manual",
        userEdited: true,
      }).returning();
      goal = rows[0];
    }

    res.json(serializeGoal(goal!));
  } catch (err) {
    req.log.error({ err }, "Failed to create budget goal");
    res.status(500).json({ error: "Failed to create budget goal" });
  }
});

// ── Update goal limit (marks as user-edited) ───────────────────────────────

router.put("/budget/goals/:id", async (req, res) => {
  try {
    const { id } = UpdateBudgetGoalParams.parse(req.params);
    const body = UpdateBudgetGoalBody.parse(req.body);

    const rows = await db.update(budgetGoalsTable)
      .set({
        monthlyLimit: body.monthlyLimit.toFixed(2),
        userEdited: true,
        updatedAt: new Date(),
      })
      .where(eq(budgetGoalsTable.id, id))
      .returning();

    if (!rows[0]) return res.status(404).json({ error: "Goal not found" });
    res.json(serializeGoal(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to update budget goal");
    res.status(500).json({ error: "Failed to update budget goal" });
  }
});

// ── Delete goal ────────────────────────────────────────────────────────────

router.delete("/budget/goals/:id", async (req, res) => {
  try {
    const { id } = DeleteBudgetGoalParams.parse(req.params);
    await db.delete(budgetGoalsTable).where(eq(budgetGoalsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete budget goal");
    res.status(500).json({ error: "Failed to delete budget goal" });
  }
});

// ── Auto-generate goals from 12 months of history ─────────────────────────

router.post("/budget/auto-generate", async (req, res) => {
  try {
    const result = await autoGenerateBudgetGoals(req.log);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to auto-generate budget goals");
    res.status(500).json({ error: "Failed to auto-generate budget goals" });
  }
});

// ── Budget status for current month ───────────────────────────────────────

router.get("/budget/status", async (req, res) => {
  try {
    const monthParam = (req.query["month"] as string) || new Date().toISOString().substring(0, 7);
    const startDate = `${monthParam}-01`;
    const [year, month] = monthParam.split("-").map(Number);
    const lastDay = new Date(year!, month!, 0).getDate();
    const endDate = `${monthParam}-${String(lastDay).padStart(2, "0")}`;

    const goals = await db.select().from(budgetGoalsTable).orderBy(budgetGoalsTable.category);

    if (goals.length === 0) {
      return res.json({ month: monthParam, statuses: [], totalBudgeted: 0, totalSpent: 0 });
    }

    const spendingRows = await db
      .select({
        category: sql<string>`coalesce(${transactionsTable.userCategory}, ${transactionsTable.categoryName}, 'Uncategorised')`,
        spent: sql<number>`sum(${transactionsTable.amount}::numeric)`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.creditDebit, "debit"),
          eq(transactionsTable.isTransfer, false),
          gte(transactionsTable.transactionDate, startDate),
          lte(transactionsTable.transactionDate, endDate)
        )
      )
      .groupBy(sql`coalesce(${transactionsTable.userCategory}, ${transactionsTable.categoryName}, 'Uncategorised')`);

    const spendingMap = new Map<string, number>();
    for (const row of spendingRows) {
      spendingMap.set(row.category.toLowerCase(), Number(row.spent));
    }

    const statuses = goals.map((goal) => {
      let spent = spendingMap.get(goal.category.toLowerCase()) ?? 0;
      if (spent === 0) {
        for (const [cat, amount] of spendingMap) {
          if (cat.includes(goal.category.toLowerCase()) || goal.category.toLowerCase().includes(cat)) {
            spent = amount;
            break;
          }
        }
      }

      const limit = parseFloat(goal.monthlyLimit);
      const remaining = limit - spent;
      const percentUsed = limit > 0 ? (spent / limit) * 100 : 0;

      return {
        category: goal.category,
        monthlyLimit: limit,
        avgMonthlySpend: goal.avgMonthlySpend ? parseFloat(goal.avgMonthlySpend) : null,
        source: goal.source,
        userEdited: goal.userEdited,
        spent,
        remaining,
        percentUsed: Math.min(percentUsed, 999),
        isOverBudget: spent > limit,
        goalId: goal.id,
      };
    });

    const totalBudgeted = goals.reduce((sum, g) => sum + parseFloat(g.monthlyLimit), 0);
    const totalSpent = statuses.reduce((sum, s) => sum + s.spent, 0);

    res.json({ month: monthParam, statuses, totalBudgeted, totalSpent });
  } catch (err) {
    req.log.error({ err }, "Failed to get budget status");
    res.status(500).json({ error: "Failed to get budget status" });
  }
});

// ── Core auto-generation logic (reused by import endpoint) ─────────────────

export async function autoGenerateBudgetGoals(log?: any) {
  // Last 12 months
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const startDate = twelveMonthsAgo.toISOString().substring(0, 10);

  // Get monthly spend per category
  const rows = await db
    .select({
      category: sql<string>`coalesce(${transactionsTable.userCategory}, ${transactionsTable.categoryName}, 'Uncategorised')`,
      month: sql<string>`substr(${transactionsTable.transactionDate}, 1, 7)`,
      monthlyTotal: sql<number>`sum(${transactionsTable.amount}::numeric)`,
    })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.creditDebit, "debit"),
        eq(transactionsTable.isTransfer, false),
        gte(transactionsTable.transactionDate, startDate)
      )
    )
    .groupBy(
      sql`coalesce(${transactionsTable.userCategory}, ${transactionsTable.categoryName}, 'Uncategorised')`,
      sql`substr(${transactionsTable.transactionDate}, 1, 7)`
    );

  // Aggregate per category
  const categoryMap = new Map<string, { months: Set<string>; total: number }>();
  for (const row of rows) {
    const cat = row.category;
    if (!categoryMap.has(cat)) categoryMap.set(cat, { months: new Set(), total: 0 });
    const entry = categoryMap.get(cat)!;
    entry.months.add(row.month);
    entry.total += Number(row.monthlyTotal);
  }

  // Skip categories with too few months or too low spend
  const EXCLUDED = new Set(["uncategorised", "transfer between accounts", "credit card payment", "credit card payments"]);
  const MIN_MONTHLY_AVG = 30; // AUD
  const MIN_MONTHS = 2;

  const candidates = Array.from(categoryMap.entries())
    .filter(([cat, data]) => {
      if (EXCLUDED.has(cat.toLowerCase())) return false;
      if (data.months.size < MIN_MONTHS) return false;
      const avg = data.total / data.months.size;
      return avg >= MIN_MONTHLY_AVG;
    })
    .map(([cat, data]) => {
      const avgRaw = data.total / data.months.size;
      // Add 10% buffer, round up to nearest $10
      const withBuffer = avgRaw * 1.1;
      const rounded = Math.ceil(withBuffer / 10) * 10;
      return { category: cat, avgMonthlySpend: avgRaw, monthlyLimit: rounded };
    });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const resultGoals: (typeof budgetGoalsTable.$inferSelect)[] = [];

  for (const c of candidates) {
    const existing = await db.select().from(budgetGoalsTable)
      .where(ilike(budgetGoalsTable.category, c.category))
      .limit(1);

    if (existing[0]) {
      if (existing[0].userEdited) {
        // User has manually adjusted — only update the avg reference, not the limit
        const rows = await db.update(budgetGoalsTable)
          .set({ avgMonthlySpend: c.avgMonthlySpend.toFixed(2), updatedAt: new Date() })
          .where(eq(budgetGoalsTable.id, existing[0].id))
          .returning();
        resultGoals.push(rows[0]!);
        skipped++;
      } else {
        // Auto goal — update the limit to match new data
        const rows = await db.update(budgetGoalsTable)
          .set({
            monthlyLimit: c.monthlyLimit.toFixed(2),
            avgMonthlySpend: c.avgMonthlySpend.toFixed(2),
            source: "auto",
            updatedAt: new Date(),
          })
          .where(eq(budgetGoalsTable.id, existing[0].id))
          .returning();
        resultGoals.push(rows[0]!);
        updated++;
      }
    } else {
      const rows = await db.insert(budgetGoalsTable).values({
        id: randomUUID(),
        category: c.category,
        monthlyLimit: c.monthlyLimit.toFixed(2),
        avgMonthlySpend: c.avgMonthlySpend.toFixed(2),
        source: "auto",
        userEdited: false,
      }).returning();
      resultGoals.push(rows[0]!);
      created++;
    }
  }

  return {
    created,
    updated,
    skipped,
    goals: resultGoals.map(serializeGoal),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function serializeGoal(goal: typeof budgetGoalsTable.$inferSelect) {
  return {
    id: goal.id,
    category: goal.category,
    monthlyLimit: parseFloat(goal.monthlyLimit),
    source: goal.source as "auto" | "manual",
    avgMonthlySpend: goal.avgMonthlySpend ? parseFloat(goal.avgMonthlySpend) : null,
    userEdited: goal.userEdited,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export default router;
