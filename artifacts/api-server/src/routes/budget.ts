import { Router } from "express";
import { db } from "@workspace/db";
import { budgetGoalsTable, transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, ilike, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { CreateBudgetGoalBody, DeleteBudgetGoalParams } from "@workspace/api-zod";

const router = Router();

router.get("/budget/goals", async (req, res) => {
  try {
    const goals = await db.select().from(budgetGoalsTable).orderBy(budgetGoalsTable.category);
    res.json({
      goals: goals.map(serializeGoal),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list budget goals");
    res.status(500).json({ error: "Failed to list budget goals" });
  }
});

router.post("/budget/goals", async (req, res) => {
  try {
    const body = CreateBudgetGoalBody.parse(req.body);

    // Upsert by category
    const existing = await db.select().from(budgetGoalsTable)
      .where(ilike(budgetGoalsTable.category, body.category))
      .limit(1);

    let goal;
    if (existing[0]) {
      const rows = await db.update(budgetGoalsTable)
        .set({ monthlyLimit: body.monthlyLimit.toFixed(2), updatedAt: new Date() })
        .where(eq(budgetGoalsTable.id, existing[0].id))
        .returning();
      goal = rows[0];
    } else {
      const rows = await db.insert(budgetGoalsTable).values({
        id: randomUUID(),
        category: body.category,
        monthlyLimit: body.monthlyLimit.toFixed(2),
      }).returning();
      goal = rows[0];
    }

    res.json(serializeGoal(goal!));
  } catch (err) {
    req.log.error({ err }, "Failed to create budget goal");
    res.status(500).json({ error: "Failed to create budget goal" });
  }
});

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

router.get("/budget/status", async (req, res) => {
  try {
    const monthParam = (req.query["month"] as string) || new Date().toISOString().substring(0, 7);
    const startDate = `${monthParam}-01`;
    // Last day of month
    const [year, month] = monthParam.split("-").map(Number);
    const lastDay = new Date(year!, month!, 0).getDate();
    const endDate = `${monthParam}-${String(lastDay).padStart(2, "0")}`;

    const goals = await db.select().from(budgetGoalsTable).orderBy(budgetGoalsTable.category);

    if (goals.length === 0) {
      return res.json({ month: monthParam, statuses: [], totalBudgeted: 0, totalSpent: 0 });
    }

    // Get spending per category for the month (debits only, excluding transfers)
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
      // Try exact match, then partial match
      let spent = spendingMap.get(goal.category.toLowerCase()) ?? 0;

      // Fuzzy match: if no exact match, try to find a category that contains the goal category name
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

function serializeGoal(goal: typeof budgetGoalsTable.$inferSelect) {
  return {
    id: goal.id,
    category: goal.category,
    monthlyLimit: parseFloat(goal.monthlyLimit),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export default router;
