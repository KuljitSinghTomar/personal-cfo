import { useState } from "react";
import {
  useListBudgetGoals,
  getListBudgetGoalsQueryKey,
  useCreateBudgetGoal,
  useDeleteBudgetGoal,
  useUpdateBudgetGoal,
  useAutoGenerateBudgets,
  useGetBudgetStatus,
  getGetBudgetStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Target, AlertTriangle, CheckCircle,
  TrendingUp, Sparkles, Pencil, X, Check, RefreshCw, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  "Groceries", "Dining", "Transport", "Utilities", "Entertainment",
  "Health", "Shopping", "General Merchandise", "Personal Care",
  "Education", "Travel", "Subscriptions", "Other",
];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);
}

function ProgressBar({ percent, isOver }: { percent: number; isOver: boolean }) {
  const clamped = Math.min(percent, 100);
  const colour = isOver ? "bg-red-500" : clamped > 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${colour}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function SourceBadge({ source, userEdited }: { source: string; userEdited: boolean }) {
  if (userEdited) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded">
        <Pencil className="w-2.5 h-2.5" /> Edited
      </span>
    );
  }
  if (source === "auto") {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded">
        <Sparkles className="w-2.5 h-2.5" /> Auto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-secondary text-muted-foreground border border-border px-1.5 py-0.5 rounded">
      Manual
    </span>
  );
}

interface InlineEditProps {
  goalId: string;
  current: number;
  onDone: () => void;
}
function InlineEdit({ goalId, current, onDone }: InlineEditProps) {
  const [value, setValue] = useState(String(Math.round(current)));
  const updateMutation = useUpdateBudgetGoal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const currentMonth = new Date().toISOString().substring(0, 7);

  const save = () => {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return;
    updateMutation.mutate(
      { id: goalId, data: { monthlyLimit: v } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBudgetGoalsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) });
          toast({ title: "Updated", description: "Monthly limit saved" });
          onDone();
        },
      }
    );
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">$</span>
      <input
        autoFocus
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onDone(); }}
        className="w-24 h-7 text-sm bg-input border border-border rounded px-2 tabular-nums text-foreground"
      />
      <button onClick={save} disabled={updateMutation.isPending} className="p-1 text-emerald-400 hover:text-emerald-300">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDone} className="p-1 text-muted-foreground hover:text-foreground">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function Budget() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentMonth = new Date().toISOString().substring(0, 7);

  const [newCategory, setNewCategory] = useState(CATEGORIES[0]!);
  const [customCategory, setCustomCategory] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [newLimit, setNewLimit] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const goals = useListBudgetGoals({ query: { queryKey: getListBudgetGoalsQueryKey() } });
  const status = useGetBudgetStatus(
    { month: currentMonth },
    { query: { queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) } }
  );
  const createMutation = useCreateBudgetGoal();
  const deleteMutation = useDeleteBudgetGoal();
  const autoGenMutation = useAutoGenerateBudgets();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListBudgetGoalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) });
  };

  const handleAutoGenerate = () => {
    autoGenMutation.mutate(undefined, {
      onSuccess: (result) => {
        invalidateAll();
        toast({
          title: "Budgets generated",
          description: `${result.created} created, ${result.updated} updated, ${result.skipped} kept as-is (you edited them)`,
        });
      },
      onError: () => toast({ title: "Error", description: "Could not auto-generate budgets", variant: "destructive" }),
    });
  };

  const handleCreate = () => {
    const category = useCustom ? customCategory.trim() : newCategory;
    const limit = parseFloat(newLimit);
    if (!category || isNaN(limit) || limit <= 0) {
      toast({ title: "Invalid input", description: "Enter a valid category and monthly limit.", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { category, monthlyLimit: limit } },
      {
        onSuccess: () => {
          toast({ title: "Goal saved", description: `Budget set for ${category}` });
          setNewLimit(""); setCustomCategory(""); setShowAddForm(false);
          invalidateAll();
        },
        onError: () => toast({ title: "Error", description: "Could not save goal.", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: string, category: string) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Removed", description: `Budget for ${category} removed` });
        invalidateAll();
      },
    });
  };

  const s = status.data;
  const overBudgetCount = (s?.statuses ?? []).filter((s) => s.isOverBudget).length;
  const goalCount = goals.data?.goals.length ?? 0;

  // Build display list merging goals with status data
  const displayItems = (s?.statuses ?? []).length > 0
    ? s!.statuses
    : (goals.data?.goals ?? []).map((g) => ({
        category: g.category,
        monthlyLimit: g.monthlyLimit,
        avgMonthlySpend: g.avgMonthlySpend ?? null,
        source: g.source,
        userEdited: g.userEdited,
        spent: 0,
        remaining: g.monthlyLimit,
        percentUsed: 0,
        isOverBudget: false,
        goalId: g.id,
      }));

  const goalById = new Map((goals.data?.goals ?? []).map((g) => [g.id, g]));

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Budget Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Auto-generated from your 12-month history · adjust any limit anytime
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoGenerate}
            disabled={autoGenMutation.isPending}
            className="flex items-center gap-1.5"
            data-testid="button-auto-generate"
          >
            {autoGenMutation.isPending
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
            Regenerate from history
          </Button>
          <Button
            size="sm"
            variant={showAddForm ? "secondary" : "outline"}
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add goal
          </Button>
        </div>
      </div>

      {/* Add goal form (collapsible) */}
      {showAddForm && (
        <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Add / Override Goal
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Category</Label>
              <div className="flex gap-1 mb-1">
                <button onClick={() => setUseCustom(false)} className={`text-xs px-2 py-0.5 rounded border transition-colors ${!useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>Preset</button>
                <button onClick={() => setUseCustom(true)} className={`text-xs px-2 py-0.5 rounded border transition-colors ${useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>Custom</button>
              </div>
              {useCustom
                ? <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Coffee shops" className="h-8 text-sm" />
                : <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
              }
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Monthly Limit (AUD)</Label>
              <Input type="number" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder="e.g. 800" className="h-8 text-sm" min={1} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="h-8 flex-1">Save</Button>
              <Button variant="outline" onClick={() => setShowAddForm(false)} className="h-8 px-3">Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Summary strip */}
      {s && goalCount > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-card-border rounded-lg p-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Total Budgeted</p>
            <p className="text-lg font-bold tabular-nums mt-0.5">{formatCurrency(s.totalBudgeted)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{goalCount} categories</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Spent This Month</p>
            <p className={`text-lg font-bold tabular-nums mt-0.5 ${s.totalSpent > s.totalBudgeted ? "text-red-400" : ""}`}>
              {formatCurrency(s.totalSpent)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(s.totalBudgeted - s.totalSpent)} remaining</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {overBudgetCount > 0
                ? <AlertTriangle className="w-4 h-4 text-red-400" />
                : <CheckCircle className="w-4 h-4 text-emerald-400" />}
              <p className="text-lg font-bold">{overBudgetCount > 0 ? `${overBudgetCount} over` : "On track"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Goals list */}
      {goals.isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-card border border-card-border rounded-lg animate-pulse" />)}</div>
      ) : goalCount === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-12 flex flex-col items-center justify-center gap-4 text-center">
          <Sparkles className="w-8 h-8 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">No budget goals yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Import your transactions CSV and goals will be automatically created from your spending patterns.
            </p>
          </div>
          <Button onClick={handleAutoGenerate} disabled={autoGenMutation.isPending} className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            {autoGenMutation.isPending ? "Generating..." : "Generate from history"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {displayItems.map((item) => {
            const goal = goalById.get(item.goalId);
            const isEditing = editingId === item.goalId;

            return (
              <div
                key={item.goalId}
                className={`bg-card border rounded-lg p-4 transition-colors ${item.isOverBudget ? "border-red-500/30" : "border-card-border"}`}
                data-testid={`budget-card-${item.category}`}
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  {/* Left: category + badges */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.category}</span>
                      <SourceBadge source={(item as any).source ?? goal?.source ?? "auto"} userEdited={(item as any).userEdited ?? goal?.userEdited ?? false} />
                      {item.isOverBudget && (
                        <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">Over budget</span>
                      )}
                      {!item.isOverBudget && item.percentUsed > 80 && item.percentUsed <= 100 && (
                        <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">Near limit</span>
                      )}
                    </div>

                    {/* Spend line */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>
                        <span className={`font-semibold tabular-nums ${item.isOverBudget ? "text-red-400" : "text-foreground"}`}>
                          {formatCurrency(item.spent)}
                        </span>{" "}spent
                      </span>
                      <span>of limit</span>
                      {isEditing
                        ? <InlineEdit goalId={item.goalId} current={item.monthlyLimit} onDone={() => setEditingId(null)} />
                        : (
                          <button
                            onClick={() => setEditingId(item.goalId)}
                            className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 group"
                            title="Click to edit limit"
                          >
                            {formatCurrency(item.monthlyLimit)}
                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </button>
                        )
                      }
                      {item.remaining >= 0
                        ? <span>{formatCurrency(item.remaining)} left</span>
                        : <span className="text-red-400 font-semibold">{formatCurrency(Math.abs(item.remaining))} over</span>
                      }
                      {(item as any).avgMonthlySpend != null && !item.isOverBudget && (
                        <span className="text-muted-foreground/60 flex items-center gap-0.5">
                          <Info className="w-2.5 h-2.5" />
                          avg {formatCurrency((item as any).avgMonthlySpend)}/mo
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: percent + actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-sm font-bold tabular-nums w-10 text-right ${item.isOverBudget ? "text-red-400" : item.percentUsed > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                      {item.percentUsed.toFixed(0)}%
                    </span>
                    <button
                      onClick={() => setEditingId(isEditing ? null : item.goalId)}
                      className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                      title="Edit limit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.goalId, item.category)}
                      className="p-1.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/30 transition-colors"
                      title="Remove goal"
                      data-testid={`button-delete-goal-${item.goalId}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <ProgressBar percent={item.percentUsed} isOver={item.isOverBudget} />
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-generated info note */}
      {goalCount > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary" />
          Auto limits = 12-month average + 10% buffer, rounded to nearest $10. Click any limit to edit it — edited goals are never overwritten by auto-generate.
        </p>
      )}
    </div>
  );
}
