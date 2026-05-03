import { pgTable, text, numeric, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  description: text("description").notNull(),
  userDescription: text("user_description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("AUD"),
  transactionDate: text("transaction_date").notNull(),
  postedDate: text("posted_date"),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  creditDebit: text("credit_debit").notNull(),
  transactionType: text("transaction_type").notNull().default(""),
  providerName: text("provider_name").notNull().default(""),
  merchantName: text("merchant_name"),
  budgetCategory: text("budget_category"),
  categoryName: text("category_name"),
  userCategory: text("user_category"),
  userTags: jsonb("user_tags").$type<string[]>().default([]),
  notes: text("notes"),
  isTransfer: boolean("is_transfer").notNull().default(false),
  isInvestment: boolean("is_investment").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  aiConfidenceScore: numeric("ai_confidence_score", { precision: 4, scale: 3 }),
  included: boolean("included").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
