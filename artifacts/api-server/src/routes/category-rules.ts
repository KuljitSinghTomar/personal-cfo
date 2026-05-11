import { Router } from "express";
import { db } from "@workspace/db";
import { categoryRulesTable, transactionsTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

function matchesPattern(text: string, matchPattern: string): boolean {
  const lower = text.toLowerCase();
  return matchPattern
    .split("|")
    .some((orPart) => orPart.split("&").every((term) => lower.includes(term.trim().toLowerCase())));
}

const VALID_FIELDS = new Set(["merchant", "description", "category"]);

const router = Router();

// ── List all rules ─────────────────────────────────────────────────────────

router.get("/category-rules", async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(categoryRulesTable)
      .orderBy(categoryRulesTable.createdAt);
    res.json({ rules });
  } catch (err) {
    req.log.error({ err }, "Failed to list category rules");
    res.status(500).json({ error: "Failed to list category rules" });
  }
});

// ── Create a rule ─────────────────────────────────────────────────────────

router.post("/category-rules", async (req, res) => {
  try {
    const { matchPattern, matchField, category } = req.body as Record<string, string>;
    if (!matchPattern?.trim() || !category?.trim() || !VALID_FIELDS.has(matchField)) {
      return res.status(400).json({ error: "matchPattern, matchField and category are required" });
    }
    const id = randomUUID();
    const [rule] = await db
      .insert(categoryRulesTable)
      .values({ id, matchPattern: matchPattern.trim(), matchField, category: category.trim(), isActive: true })
      .returning();
    res.json({ rule });
  } catch (err) {
    req.log.error({ err }, "Failed to create category rule");
    res.status(500).json({ error: "Failed to create category rule" });
  }
});

// ── Update a rule (toggle active, edit pattern/field/category) ────────────

router.patch("/category-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const raw = req.body as Record<string, unknown>;
    const body: Record<string, unknown> = {};
    if (typeof raw.matchPattern === "string" && raw.matchPattern.trim()) body.matchPattern = raw.matchPattern.trim();
    if (typeof raw.matchField === "string" && VALID_FIELDS.has(raw.matchField)) body.matchField = raw.matchField;
    if (typeof raw.category === "string" && raw.category.trim()) body.category = raw.category.trim();
    if (typeof raw.isActive === "boolean") body.isActive = raw.isActive;
    const [rule] = await db
      .update(categoryRulesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(categoryRulesTable.id, id))
      .returning();
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    res.json({ rule });
  } catch (err) {
    req.log.error({ err }, "Failed to update category rule");
    res.status(500).json({ error: "Failed to update category rule" });
  }
});

// ── Delete a rule ─────────────────────────────────────────────────────────

router.delete("/category-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(categoryRulesTable).where(eq(categoryRulesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete category rule");
    res.status(500).json({ error: "Failed to delete category rule" });
  }
});

// ── Apply all active rules to existing transactions ────────────────────────
// By default only fills in transactions that have no userCategory yet.
// Pass { overwrite: true } to re-apply on top of existing manual categories.

router.post("/category-rules/apply", async (req, res) => {
  try {
    const overwrite = req.body?.overwrite === true;

    const activeRules = await db
      .select()
      .from(categoryRulesTable)
      .where(eq(categoryRulesTable.isActive, true));

    if (activeRules.length === 0) {
      return res.json({ applied: 0, rulesProcessed: 0, message: "No active rules to apply" });
    }

    const rows = await db
      .select({
        id: transactionsTable.id,
        merchantName: transactionsTable.merchantName,
        description: transactionsTable.description,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
      })
      .from(transactionsTable)
      .where(overwrite ? undefined : isNull(transactionsTable.userCategory));

    let applied = 0;

    for (const tx of rows) {
      for (const rule of activeRules) {
        let matches = false;
        if (rule.matchField === "merchant" && tx.merchantName) {
          matches = matchesPattern(tx.merchantName, rule.matchPattern);
        } else if (rule.matchField === "description") {
          matches = matchesPattern(tx.description, rule.matchPattern);
        } else if (rule.matchField === "category" && tx.categoryName) {
          matches = matchesPattern(tx.categoryName, rule.matchPattern);
        }
        if (matches) {
          await db
            .update(transactionsTable)
            .set({ userCategory: rule.category, updatedAt: new Date() })
            .where(eq(transactionsTable.id, tx.id));
          applied++;
          break; // first matching rule wins
        }
      }
    }

    req.log.info({ applied, rulesProcessed: activeRules.length }, "Rules applied to transactions");
    res.json({
      applied,
      rulesProcessed: activeRules.length,
      message: `Applied ${activeRules.length} rule${activeRules.length !== 1 ? "s" : ""}, updated ${applied} transaction${applied !== 1 ? "s" : ""}`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to apply category rules");
    res.status(500).json({ error: "Failed to apply category rules" });
  }
});

// ── Preview: count transactions matching a given pattern ───────────────────

router.post("/category-rules/preview", async (req, res) => {
  try {
    const { matchPattern, matchField, sampleLimit = 5 } = req.body as { matchPattern: string; matchField: string; sampleLimit?: number };
    if (!matchPattern?.trim() || !VALID_FIELDS.has(matchField)) {
      return res.status(400).json({ error: "matchPattern and matchField are required" });
    }
    const safeSampleLimit = Math.min(Math.max(1, sampleLimit), 500);

    const rows = await db
      .select({
        id: transactionsTable.id,
        merchantName: transactionsTable.merchantName,
        description: transactionsTable.description,
        categoryName: transactionsTable.categoryName,
        userCategory: transactionsTable.userCategory,
        transactionDate: transactionsTable.transactionDate,
        amount: transactionsTable.amount,
        creditDebit: transactionsTable.creditDebit,
      })
      .from(transactionsTable)
      .orderBy(desc(transactionsTable.transactionDate));

    const matching = rows.filter((tx) => {
      const field =
        matchField === "merchant" ? tx.merchantName
        : matchField === "description" ? tx.description
        : tx.categoryName;
      return field ? matchesPattern(field, matchPattern) : false;
    });

    const samples = matching.slice(0, safeSampleLimit).map((tx: typeof rows[number]) => ({
      id: tx.id,
      description: tx.description,
      transactionDate: tx.transactionDate,
      amount: parseFloat(tx.amount),
      creditDebit: tx.creditDebit,
      category: tx.userCategory ?? tx.categoryName,
    }));

    res.json({ count: matching.length, samples });
  } catch (err) {
    req.log.error({ err }, "Failed to preview category rule");
    res.status(500).json({ error: "Failed to preview" });
  }
});

export default router;
