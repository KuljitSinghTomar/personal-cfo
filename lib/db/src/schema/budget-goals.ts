import { pgTable, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";

export const budgetGoalsTable = pgTable("budget_goals", {
  id: text("id").primaryKey(),
  category: text("category").notNull().unique(),
  monthlyLimit: numeric("monthly_limit", { precision: 12, scale: 2 }).notNull(),
  source: text("source").notNull().default("manual"), // 'auto' | 'manual'
  avgMonthlySpend: numeric("avg_monthly_spend", { precision: 12, scale: 2 }),
  userEdited: boolean("user_edited").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BudgetGoal = typeof budgetGoalsTable.$inferSelect;
export type InsertBudgetGoal = typeof budgetGoalsTable.$inferInsert;
