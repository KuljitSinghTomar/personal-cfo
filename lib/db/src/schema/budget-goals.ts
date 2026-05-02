import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const budgetGoalsTable = pgTable("budget_goals", {
  id: text("id").primaryKey(),
  category: text("category").notNull().unique(),
  monthlyLimit: numeric("monthly_limit", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BudgetGoal = typeof budgetGoalsTable.$inferSelect;
export type InsertBudgetGoal = typeof budgetGoalsTable.$inferInsert;
