import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const categoryRulesTable = pgTable("category_rules", {
  id: text("id").primaryKey(),
  matchPattern: text("match_pattern").notNull(),
  matchField: text("match_field").notNull().default("merchant"), // merchant | description | category
  category: text("category").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CategoryRule = typeof categoryRulesTable.$inferSelect;
