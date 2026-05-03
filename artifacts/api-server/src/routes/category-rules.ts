import { Router } from "express";
import { db } from "@workspace/db";
import { categoryRulesTable, transactionsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod/v4";

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

const CreateRuleBody = z.object({
  matchPattern: z.string().min(1),
  matchField: z.enum(["merchant", "description", "category"]),
  category: z.string().min(1),
});

router.post("/category-rules", async (req, res) => {
  try {
    const body = CreateRuleBody.parse(req.body);
    const id = randomUUID();
    const [rule] = await db
      .insert(categoryRulesTable)
      .values({ id, ...body, isActive: true })
      .returning();
    res.json({ rule });
  } catch (err) {
    req.log.error({ err }, "Failed to create category rule");
    res.status(500).json({ error: "Failed to create category rule" });
  }
});

// ── Update a rule (toggle active, edit pattern/field/category) ────────────

const UpdateRuleBody = z.object({
  matchPattern: z.string().min(1).optional(),
  matchField: z.enum(["merchant", "description", "category"]).optional(),
  category: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/category-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = UpdateRuleBody.parse(req.body);
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
        const pattern = rule.matchPattern.toLowerCase();
        let matches = false;
        if (rule.matchField === "merchant" && tx.merchantName) {
          matches = tx.merchantName.toLowerCase().includes(pattern);
        } else if (rule.matchField === "description") {
          matches = tx.description.toLowerCase().includes(pattern);
        } else if (rule.matchField === "category" && tx.categoryName) {
          matches = tx.categoryName.toLowerCase().includes(pattern);
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

export default router;
