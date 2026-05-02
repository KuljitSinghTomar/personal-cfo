import { pgTable, text, numeric, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const netWorthAccountsTable = pgTable("net_worth_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  institution: text("institution"),
  type: text("type").notNull(), // 'asset' | 'liability'
  category: text("category").notNull(), // 'bank_account' | 'savings' | 'super' | 'property' | 'shares' | 'vehicle' | 'home_loan' | 'credit_card' | 'car_loan' | 'personal_loan' | 'other_asset' | 'other_liability'
  currentBalance: numeric("current_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  baseBalance: numeric("base_balance", { precision: 14, scale: 2 }).notNull().default("0"), // user-set starting point for derived accounts
  balanceSource: text("balance_source").notNull().default("manual"), // 'derived' | 'manual'
  linkedAccountNumber: text("linked_account_number"), // links to transactions.account_number
  linkedAccountName: text("linked_account_name"),
  isLinked: boolean("is_linked").notNull().default(false),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const netWorthSnapshotsTable = pgTable("net_worth_snapshots", {
  id: text("id").primaryKey(),
  snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
  totalAssets: numeric("total_assets", { precision: 14, scale: 2 }).notNull(),
  totalLiabilities: numeric("total_liabilities", { precision: 14, scale: 2 }).notNull(),
  netWorth: numeric("net_worth", { precision: 14, scale: 2 }).notNull(),
  breakdown: jsonb("breakdown"), // per-account snapshot
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NetWorthAccount = typeof netWorthAccountsTable.$inferSelect;
export type InsertNetWorthAccount = typeof netWorthAccountsTable.$inferInsert;
export type NetWorthSnapshot = typeof netWorthSnapshotsTable.$inferSelect;
