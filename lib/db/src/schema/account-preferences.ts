import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const accountPreferencesTable = pgTable("account_preferences", {
  accountNumber: text("account_number").primaryKey(),
  accountName: text("account_name").notNull(),
  skipped: boolean("skipped").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AccountPreference = typeof accountPreferencesTable.$inferSelect;
