import { Router } from "express";
import { db } from "@workspace/db";
import { categoryRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

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

export default router;
