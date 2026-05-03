import { useState, useEffect, useCallback } from "react";
import { Zap, Plus, Trash2, Check, X, Pencil, Play, ToggleLeft, ToggleRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

type MatchField = "merchant" | "description" | "category";

interface CategoryRule {
  id: string;
  matchPattern: string;
  matchField: MatchField;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApplyResult {
  applied: number;
  rulesProcessed: number;
  message: string;
}

const FIELD_LABELS: Record<MatchField, string> = {
  merchant: "Merchant name",
  description: "Description",
  category: "Original category",
};

const EMPTY_DRAFT = { matchPattern: "", matchField: "merchant" as MatchField, category: "" };

export default function CategoryRules() {
  const { toast } = useToast();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState(EMPTY_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadRules = useCallback(() => {
    setLoading(true);
    fetch(`${BASE}api/category-rules`)
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => toast({ title: "Failed to load rules", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const toggleActive = async (rule: CategoryRule) => {
    try {
      const res = await fetch(`${BASE}api/category-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      const data = await res.json();
      setRules((prev) => prev.map((r) => r.id === rule.id ? data.rule : r));
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  const startEdit = (rule: CategoryRule) => {
    setEditingId(rule.id);
    setEditDraft({ matchPattern: rule.matchPattern, matchField: rule.matchField, category: rule.category });
  };

  const saveEdit = async (id: string) => {
    if (!editDraft.matchPattern.trim() || !editDraft.category.trim()) return;
    setSavingId(id);
    try {
      const res = await fetch(`${BASE}api/category-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      const data = await res.json();
      setRules((prev) => prev.map((r) => r.id === id ? data.rule : r));
      setEditingId(null);
      toast({ title: "Rule updated" });
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await fetch(`${BASE}api/category-rules/${id}`, { method: "DELETE" });
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "Rule deleted" });
    } catch {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    }
  };

  const createRule = async () => {
    if (!createDraft.matchPattern.trim() || !createDraft.category.trim()) return;
    setSavingId("new");
    try {
      const res = await fetch(`${BASE}api/category-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createDraft),
      });
      const data = await res.json();
      setRules((prev) => [...prev, data.rule]);
      setCreating(false);
      setCreateDraft(EMPTY_DRAFT);
      toast({ title: "Rule created", description: `Transactions matching "${createDraft.matchPattern}" will be categorised as "${createDraft.category}"` });
    } catch {
      toast({ title: "Failed to create rule", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const applyRules = async (overwrite = false) => {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(`${BASE}api/category-rules/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite }),
      });
      const data: ApplyResult = await res.json();
      setApplyResult(data);
      toast({ title: "Rules applied", description: data.message });
    } catch {
      toast({ title: "Failed to apply rules", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const activeCount = rules.filter((r) => r.isActive).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Category Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rules automatically categorise matching transactions during CSV import and can be re-applied to all existing data.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreating(true)}
            disabled={creating}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> New rule
          </Button>
          <Button
            size="sm"
            onClick={() => applyRules(false)}
            disabled={applying || activeCount === 0}
            className="gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            {applying ? "Applying…" : "Apply to transactions"}
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          <span className="text-foreground font-medium">{rules.length}</span> rule{rules.length !== 1 ? "s" : ""} total
        </span>
        <span className="text-muted-foreground">
          <span className="text-emerald-400 font-medium">{activeCount}</span> active
        </span>
        {rules.length - activeCount > 0 && (
          <span className="text-muted-foreground">
            <span className="font-medium">{rules.length - activeCount}</span> paused
          </span>
        )}
      </div>

      {/* Apply result banner */}
      {applyResult && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-emerald-400">
            <Zap className="w-4 h-4" />
            <span className="font-medium">{applyResult.message}</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>Only unfiled transactions were updated — manual categories preserved.</span>
            <button
              onClick={() => applyRules(true)}
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Overwrite all
            </button>
            <button onClick={() => setApplyResult(null)} className="hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* How it works info */}
      <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1.5 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-primary" /> How rules work
        </p>
        <ul className="space-y-1 text-xs list-disc list-inside">
          <li>Rules run automatically every time you import a new CSV — new transactions are categorised instantly.</li>
          <li>Use <span className="text-foreground font-medium">Apply to transactions</span> to backfill existing uncategorised transactions with the current ruleset.</li>
          <li>Rules are matched in order (oldest first). The first matching rule wins.</li>
          <li>Manual category edits are never overwritten unless you choose "Overwrite all".</li>
          <li>Rules are also created automatically when you use the bulk-recategorise flow on the Transactions page.</li>
        </ul>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-card border border-primary/30 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium">New rule</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Match field</label>
              <Select
                value={createDraft.matchField}
                onValueChange={(v) => setCreateDraft((d) => ({ ...d, matchField: v as MatchField }))}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merchant">Merchant name</SelectItem>
                  <SelectItem value="description">Description contains</SelectItem>
                  <SelectItem value="category">Original category</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Pattern (case-insensitive)</label>
              <Input
                className="h-8 text-sm"
                placeholder='e.g. "Woolworths" or "BPAY"'
                value={createDraft.matchPattern}
                onChange={(e) => setCreateDraft((d) => ({ ...d, matchPattern: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && createRule()}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assign category</label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. Groceries"
                value={createDraft.category}
                onChange={(e) => setCreateDraft((d) => ({ ...d, category: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && createRule()}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setCreateDraft(EMPTY_DRAFT); }}>Cancel</Button>
            <Button size="sm" onClick={createRule} disabled={savingId === "new" || !createDraft.matchPattern.trim() || !createDraft.category.trim()}>
              {savingId === "new" ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </div>
      )}

      {/* Rules table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No rules yet</p>
          <p className="text-xs mt-1">Rules are created automatically when you bulk-recategorise transactions, or you can add one manually above.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-4 text-muted-foreground text-xs font-medium uppercase tracking-widest">Match field</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground text-xs font-medium uppercase tracking-widest">Pattern</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground text-xs font-medium uppercase tracking-widest">Category</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground text-xs font-medium uppercase tracking-widest">Status</th>
                <th className="text-right py-2.5 px-4 text-muted-foreground text-xs font-medium uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className={`border-b border-border last:border-0 transition-colors ${rule.isActive ? "hover:bg-muted/20" : "opacity-50 hover:bg-muted/20"}`}>
                  {editingId === rule.id ? (
                    <>
                      <td className="py-2 px-3">
                        <Select
                          value={editDraft.matchField}
                          onValueChange={(v) => setEditDraft((d) => ({ ...d, matchField: v as MatchField }))}
                        >
                          <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="merchant">Merchant name</SelectItem>
                            <SelectItem value="description">Description</SelectItem>
                            <SelectItem value="category">Original category</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          className="h-7 text-xs"
                          value={editDraft.matchPattern}
                          onChange={(e) => setEditDraft((d) => ({ ...d, matchPattern: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(rule.id); if (e.key === "Escape") setEditingId(null); }}
                          autoFocus
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          className="h-7 text-xs"
                          value={editDraft.category}
                          onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(rule.id); if (e.key === "Escape") setEditingId(null); }}
                        />
                      </td>
                      <td className="py-2 px-3" />
                      <td className="py-2 px-3">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => saveEdit(rule.id)}
                            disabled={savingId === rule.id}
                            className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {FIELD_LABELS[rule.matchField]}
                      </td>
                      <td className="py-3 px-4">
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{rule.matchPattern}</code>
                      </td>
                      <td className="py-3 px-4">
                        <span className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded text-xs font-medium">
                          {rule.category}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => toggleActive(rule)}
                          className={`flex items-center gap-1.5 text-xs transition-colors ${rule.isActive ? "text-emerald-400" : "text-muted-foreground"}`}
                          title={rule.isActive ? "Click to pause" : "Click to activate"}
                        >
                          {rule.isActive ? (
                            <ToggleRight className="w-4 h-4" />
                          ) : (
                            <ToggleLeft className="w-4 h-4" />
                          )}
                          {rule.isActive ? "Active" : "Paused"}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => startEdit(rule)}
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                            title="Edit rule"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
