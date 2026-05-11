import { useState, useEffect, useCallback, useRef } from "react";
import { Zap, Plus, Trash2, Check, X, Pencil, Play, ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

interface PreviewResult {
  count: number;
  samples: {
    id: string;
    description: string;
    transactionDate: string;
    amount: number;
    creditDebit: "credit" | "debit";
    category: string | null;
  }[];
}

const FIELD_LABELS: Record<MatchField, string> = {
  merchant: "Merchant name",
  description: "Description",
  category: "Original category",
};

const EMPTY_DRAFT = { matchPattern: "", matchField: "merchant" as MatchField, category: "" };

function formatCurrency(n: number) {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

// ── Edit / Preview Modal ───────────────────────────────────────────────────

function RuleEditModal({
  rule,
  onSave,
  onClose,
}: {
  rule: CategoryRule;
  onSave: (id: string, draft: typeof EMPTY_DRAFT) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    matchPattern: rule.matchPattern,
    matchField: rule.matchField,
    category: rule.category,
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedSamples, setExpandedSamples] = useState<PreviewResult["samples"] | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreview = useCallback((pattern: string, field: MatchField, sampleLimit?: number) => {
    if (!pattern.trim()) { setPreview(null); return; }
    const isExpand = sampleLimit !== undefined && sampleLimit > 5;
    if (isExpand) setExpandedLoading(true); else setPreviewLoading(true);
    fetch(`${BASE}api/category-rules/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchPattern: pattern.trim(), matchField: field, ...(sampleLimit ? { sampleLimit } : {}) }),
    })
      .then((r) => r.json())
      .then((d) => { if (isExpand) setExpandedSamples(d.samples); else setPreview(d); })
      .catch(() => { if (!isExpand) setPreview(null); })
      .finally(() => { if (isExpand) setExpandedLoading(false); else setPreviewLoading(false); });
  }, []);

  // Fetch preview for current rule on open
  useEffect(() => {
    fetchPreview(draft.matchPattern, draft.matchField);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schedulPreview = (pattern: string, field: MatchField) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(pattern, field), 300);
  };

  const update = (changes: Partial<typeof draft>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    setExpandedSamples(null);
    schedulPreview(next.matchPattern, next.matchField);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(rule.id, draft);
    setSaving(false);
  };

  const patternParts = draft.matchPattern.split("|").map((p) => p.trim()).filter(Boolean);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fields */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Match field</label>
              <Select
                value={draft.matchField}
                onValueChange={(v) => update({ matchField: v as MatchField })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merchant">Merchant name</SelectItem>
                  <SelectItem value="description">Description contains</SelectItem>
                  <SelectItem value="category">Original category</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Pattern
                <span className="ml-1 text-muted-foreground/60">(case-insensitive · use | to match any of multiple words)</span>
              </label>
              <Input
                className="h-9 text-sm font-mono"
                value={draft.matchPattern}
                onChange={(e) => update({ matchPattern: e.target.value })}
                autoFocus
              />
              {patternParts.length > 1 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {patternParts.map((p) => (
                    <code key={p} className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{p}</code>
                  ))}
                  <span className="text-xs text-muted-foreground self-center">— matches any</span>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assign category</label>
              <Input
                className="h-9 text-sm"
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {previewLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 text-primary" />}
              Live match preview
            </div>

            {!draft.matchPattern.trim() ? (
              <p className="text-xs text-muted-foreground">Enter a pattern to see matching transactions.</p>
            ) : previewLoading ? (
              <p className="text-xs text-muted-foreground">Scanning transactions…</p>
            ) : preview ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  {preview.count === 0
                    ? "No transactions match this rule"
                    : `${preview.count} transaction${preview.count !== 1 ? "s" : ""} match this rule`}
                </p>
                {preview.samples.length > 0 && (
                  <div className="space-y-1">
                    <div className={expandedSamples ? "max-h-64 overflow-y-auto space-y-1" : "space-y-1"}>
                      {(expandedSamples ?? preview.samples).map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-1 px-2 rounded bg-muted/60 text-xs">
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate font-mono text-[11px]">{s.description}</p>
                            <p className="text-muted-foreground">{s.transactionDate} · {s.category ?? "—"}</p>
                          </div>
                          <span className={`flex-shrink-0 font-semibold ml-3 ${s.creditDebit === "credit" ? "text-emerald-400" : "text-foreground"}`}>
                            {s.creditDebit === "debit" ? "-" : "+"}{formatCurrency(s.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {!expandedSamples && preview.count > 5 && (
                      <button
                        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors cursor-pointer"
                        onClick={() => fetchPreview(draft.matchPattern, draft.matchField, preview.count)}
                        disabled={expandedLoading}
                      >
                        {expandedLoading ? "Loading…" : `+ ${preview.count - 5} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !draft.matchPattern.trim() || !draft.category.trim()}
            >
              {saving ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create form with live preview ─────────────────────────────────────────

function CreateRuleForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rule: CategoryRule) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreview = useCallback((pattern: string, field: MatchField) => {
    if (!pattern.trim()) { setPreview(null); return; }
    setPreviewLoading(true);
    fetch(`${BASE}api/category-rules/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchPattern: pattern.trim(), matchField: field }),
    })
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, []);

  const update = (changes: Partial<typeof draft>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(next.matchPattern, next.matchField), 300);
  };

  const handleCreate = async () => {
    if (!draft.matchPattern.trim() || !draft.category.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/category-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      onCreated(data.rule);
      toast({ title: "Rule created", description: `Transactions matching "${draft.matchPattern}" → "${draft.category}"` });
    } catch {
      toast({ title: "Failed to create rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const patternParts = draft.matchPattern.split("|").map((p) => p.trim()).filter(Boolean);

  return (
    <div className="bg-card border border-primary/30 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium">New rule</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Match field</label>
          <Select
            value={draft.matchField}
            onValueChange={(v) => update({ matchField: v as MatchField })}
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
          <label className="text-xs text-muted-foreground mb-1 block">Pattern (case-insensitive · | for OR)</label>
          <Input
            className="h-8 text-sm font-mono"
            placeholder='e.g. "CHILLI" or "CHILLI|RED HOT"'
            value={draft.matchPattern}
            onChange={(e) => update({ matchPattern: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          {patternParts.length > 1 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {patternParts.map((p) => (
                <code key={p} className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">{p}</code>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Assign category</label>
          <Input
            className="h-8 text-sm"
            placeholder="e.g. Groceries"
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
      </div>

      {/* Inline preview for create form */}
      {draft.matchPattern.trim() && (
        <div className="bg-muted/30 rounded px-3 py-2 text-xs flex items-center gap-2">
          {previewLoading ? (
            <><RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Scanning…</span></>
          ) : preview ? (
            <span className={preview.count > 0 ? "text-foreground" : "text-muted-foreground"}>
              <span className="font-semibold">{preview.count}</span> existing transaction{preview.count !== 1 ? "s" : ""} would match this rule
            </span>
          ) : null}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleCreate} disabled={saving || !draft.matchPattern.trim() || !draft.category.trim()}>
          {saving ? "Saving…" : "Save rule"}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CategoryRules() {
  const { toast } = useToast();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [editingRule, setEditingRule] = useState<CategoryRule | null>(null);
  const [creating, setCreating] = useState(false);

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

  const saveEdit = async (id: string, draft: typeof EMPTY_DRAFT) => {
    try {
      const res = await fetch(`${BASE}api/category-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      setRules((prev) => prev.map((r) => r.id === id ? data.rule : r));
      setEditingRule(null);
      toast({ title: "Rule updated" });
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
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
          <li>Patterns support <span className="text-foreground font-mono">|</span> to match any of multiple words, e.g. <span className="font-mono">CHILLI|RED HOT</span>.</li>
        </ul>
      </div>

      {/* Create form */}
      {creating && (
        <CreateRuleForm
          onCreated={(rule) => {
            setRules((prev) => [...prev, rule]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
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
                  <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                    {FIELD_LABELS[rule.matchField]}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {rule.matchPattern.split("|").map((p) => p.trim()).filter(Boolean).map((p) => (
                        <code key={p} className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{p}</code>
                      ))}
                    </div>
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
                        onClick={() => setEditingRule(rule)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          onSave={saveEdit}
          onClose={() => setEditingRule(null)}
        />
      )}
    </div>
  );
}
