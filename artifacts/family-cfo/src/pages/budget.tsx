import { useState } from "react";
import {
  useListBudgetGoals,
  getListBudgetGoalsQueryKey,
  useCreateBudgetGoal,
  useDeleteBudgetGoal,
  useGetBudgetStatus,
  getGetBudgetStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Target, AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Entertainment",
  "Health",
  "Shopping",
  "General Merchandise",
  "Personal Care",
  "Education",
  "Travel",
  "Subscriptions",
  "Other",
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

function ProgressBar({ percent, isOver }: { percent: number; isOver: boolean }) {
  const clamped = Math.min(percent, 100);
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${isOver ? "bg-red-500" : clamped > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export default function Budget() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newCategory, setNewCategory] = useState(CATEGORIES[0]!);
  const [customCategory, setCustomCategory] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [newLimit, setNewLimit] = useState("");

  const currentMonth = new Date().toISOString().substring(0, 7);

  const goals = useListBudgetGoals({ query: { queryKey: getListBudgetGoalsQueryKey() } });
  const status = useGetBudgetStatus({ month: currentMonth }, {
    query: { queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) },
  });
  const createMutation = useCreateBudgetGoal();
  const deleteMutation = useDeleteBudgetGoal();

  const handleCreate = () => {
    const category = useCustom ? customCategory.trim() : newCategory;
    const limit = parseFloat(newLimit);
    if (!category || isNaN(limit) || limit <= 0) {
      toast({ title: "Invalid input", description: "Please enter a valid category and monthly limit.", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      { data: { category, monthlyLimit: limit } },
      {
        onSuccess: () => {
          toast({ title: "Goal saved", description: `Budget set for ${category}` });
          setNewLimit("");
          setCustomCategory("");
          queryClient.invalidateQueries({ queryKey: getListBudgetGoalsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) });
        },
        onError: () => {
          toast({ title: "Error", description: "Could not save budget goal.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: string, category: string) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Removed", description: `Budget goal for ${category} removed` });
          queryClient.invalidateQueries({ queryKey: getListBudgetGoalsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBudgetStatusQueryKey({ month: currentMonth }) });
        },
      }
    );
  };

  const s = status.data;
  const overBudgetCount = (s?.statuses ?? []).filter((s) => s.isOverBudget).length;
  const onTrackCount = (s?.statuses ?? []).filter((s) => !s.isOverBudget && s.percentUsed < 80).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Budget Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set monthly spending limits per category — tracked against your real transactions
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {currentMonth}
        </div>
      </div>

      {/* Summary Row */}
      {s && s.statuses.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Total Budgeted</p>
            <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(s.totalBudgeted)}</p>
            <p className="text-xs text-muted-foreground mt-1">across {s.statuses.length} categories</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Spent This Month</p>
            <p className={`text-xl font-bold tabular-nums mt-1 ${s.totalSpent > s.totalBudgeted ? "text-red-400" : "text-foreground"}`}>
              {formatCurrency(s.totalSpent)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(s.totalBudgeted - s.totalSpent)} remaining
            </p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="flex items-center gap-2 mt-1">
              {overBudgetCount > 0 ? (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              ) : (
                <CheckCircle className="w-5 h-5 text-emerald-400" />
              )}
              <p className="text-xl font-bold">
                {overBudgetCount > 0 ? `${overBudgetCount} over` : "On track"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{onTrackCount} on track</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Goal Form */}
        <div className="lg:col-span-1 bg-card border border-card-border rounded-lg p-5 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Add Budget Goal</h2>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Category</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setUseCustom(false)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${!useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
              >
                Preset
              </button>
              <button
                onClick={() => setUseCustom(true)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
              >
                Custom
              </button>
            </div>
            {useCustom ? (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. Coffee shops"
                className="h-9 text-sm"
                data-testid="input-custom-category"
              />
            ) : (
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Monthly Limit (AUD)</Label>
            <Input
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              placeholder="e.g. 800"
              className="h-9 text-sm"
              min={1}
              data-testid="input-monthly-limit"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="w-full flex items-center gap-2"
            data-testid="button-add-goal"
          >
            <Plus className="w-4 h-4" />
            {createMutation.isPending ? "Saving..." : "Save Goal"}
          </Button>

          <p className="text-xs text-muted-foreground">
            If a goal already exists for this category, it will be updated.
          </p>
        </div>

        {/* Budget Status Cards */}
        <div className="lg:col-span-2 space-y-3">
          {goals.isLoading || status.isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />
              ))}
            </div>
          ) : (goals.data?.goals ?? []).length === 0 ? (
            <div className="bg-card border border-card-border rounded-lg p-12 flex flex-col items-center justify-center gap-3">
              <TrendingUp className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                No budget goals yet. Add your first goal to start tracking your spending.
              </p>
            </div>
          ) : (
            (s?.statuses ?? goals.data?.goals.map((g) => ({
              category: g.category,
              monthlyLimit: g.monthlyLimit,
              spent: 0,
              remaining: g.monthlyLimit,
              percentUsed: 0,
              isOverBudget: false,
              goalId: g.id,
            })) ?? []).map((item) => (
              <div
                key={item.goalId}
                className={`bg-card border rounded-lg p-4 transition-colors ${item.isOverBudget ? "border-red-500/30" : "border-card-border"}`}
                data-testid={`budget-card-${item.category}`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{item.category}</span>
                      {item.isOverBudget && (
                        <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">Over budget</span>
                      )}
                      {!item.isOverBudget && item.percentUsed > 80 && (
                        <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">Near limit</span>
                      )}
                      {!item.isOverBudget && item.percentUsed <= 80 && item.spent > 0 && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">On track</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>
                        <span className={`font-semibold tabular-nums ${item.isOverBudget ? "text-red-400" : "text-foreground"}`}>
                          {formatCurrency(item.spent)}
                        </span>
                        {" "}spent
                      </span>
                      <span>of <span className="font-semibold text-foreground">{formatCurrency(item.monthlyLimit)}</span> limit</span>
                      <span className={item.remaining < 0 ? "text-red-400 font-semibold" : ""}>
                        {item.remaining >= 0 ? `${formatCurrency(item.remaining)} left` : `${formatCurrency(Math.abs(item.remaining))} over`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${item.isOverBudget ? "text-red-400" : item.percentUsed > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                      {item.percentUsed.toFixed(0)}%
                    </span>
                    <button
                      onClick={() => handleDelete(item.goalId, item.category)}
                      className="p-1.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/30 transition-colors"
                      title="Remove goal"
                      data-testid={`button-delete-goal-${item.goalId}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <ProgressBar percent={item.percentUsed} isOver={item.isOverBudget} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
