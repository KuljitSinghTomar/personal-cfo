import { useState, useEffect, useCallback } from "react";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetCashflow,
  getGetCashflowQueryKey,
  useGetSpendingByCategory,
  getGetSpendingByCategoryQueryKey,
  useGetAccounts,
  getGetAccountsQueryKey,
  useGetForecast,
  getGetForecastQueryKey,
  useGetAiInsights,
  getGetAiInsightsQueryKey,
  useListTransactions,
  getListTransactionsQueryKey,
  useUpdateTransaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Line,
} from "recharts";
import {
  TrendingUp, ArrowRight, AlertTriangle, Lightbulb, Info, CheckCircle,
  ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Calendar, ChevronsUpDown, Check,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { BulkApplyDialog, type BulkDialogState, type MatchCriterion } from "@/components/bulk-recategorize-dialog";

const CHART_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];
const BASE = import.meta.env.BASE_URL;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}
function formatCurrencyFull(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

// ── Date range presets ─────────────────────────────────────────────────────

type DatePreset = "last-3m" | "last-6m" | "this-fy" | "last-fy" | "last-12m" | "all-time" | "custom";
type ActiveMode = "month-nav" | DatePreset;

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "last-3m", label: "Last 3 Months" },
  { id: "last-6m", label: "Last 6 Months" },
  { id: "this-fy", label: "This FY" },
  { id: "last-fy", label: "Last FY" },
  { id: "last-12m", label: "Last 12 Months" },
  { id: "all-time", label: "All Time" },
  { id: "custom", label: "Custom…" },
];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function stepNavMonth(month: string, dir: 1 | -1): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1, 1);
  d.setMonth(d.getMonth() + dir);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function navMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleString("en-AU", { month: "long", year: "numeric" });
}

function linearTrend(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = values.reduce((s, _v, i) => s + i * i, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return values.map((_v, i) => Math.max(0, intercept + slope * i));
}

function fmtDate(d: Date) { return d.toISOString().substring(0, 10); }

function getAuFyStartYear() {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function getPresetRange(preset: DatePreset): { startDate?: string; endDate?: string } {
  const today = new Date();
  const todayStr = fmtDate(today);
  const fyYear = getAuFyStartYear();
  switch (preset) {
    case "this-month": {
      return { startDate: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: todayStr };
    }
    case "last-month": {
      return {
        startDate: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        endDate: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }
    case "last-3m": {
      return { startDate: fmtDate(new Date(today.getFullYear(), today.getMonth() - 3, 1)), endDate: todayStr };
    }
    case "last-6m": {
      return { startDate: fmtDate(new Date(today.getFullYear(), today.getMonth() - 6, 1)), endDate: todayStr };
    }
    case "this-fy": {
      return { startDate: `${fyYear}-07-01`, endDate: todayStr };
    }
    case "last-fy": {
      return { startDate: `${fyYear - 1}-07-01`, endDate: `${fyYear}-06-30` };
    }
    case "last-12m": {
      return { startDate: fmtDate(new Date(today.getFullYear(), today.getMonth() - 12, 1)), endDate: todayStr };
    }
    default: return {};
  }
}

function getPresetLabel(preset: DatePreset, customStart?: string, customEnd?: string): string {
  const today = new Date();
  const fyYear = getAuFyStartYear();
  switch (preset) {
    case "this-month": return today.toLocaleString("en-AU", { month: "long", year: "numeric" });
    case "last-month": {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return d.toLocaleString("en-AU", { month: "long", year: "numeric" });
    }
    case "last-3m": return "Last 3 Months";
    case "last-6m": return "Last 6 Months";
    case "this-fy": return `FY${fyYear}/${String(fyYear + 1).slice(2)}`;
    case "last-fy": return `FY${fyYear - 1}/${String(fyYear).slice(2)}`;
    case "last-12m": return "Last 12 Months";
    case "all-time": return "All Time";
    case "custom": return (customStart || customEnd) ? `${customStart ?? "?"} → ${customEnd ?? "?"}` : "Custom Range";
  }
}

function getMonthDateRange(month: string) {
  const [year, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year!, m!, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { startDate: start, endDate: end };
}

function pctChange(current: number, prev: number): number | undefined {
  if (!prev || prev === 0) return undefined;
  return ((current - prev) / Math.abs(prev)) * 100;
}

function InsightIcon({ type }: { type: string }) {
  if (type === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  if (type === "positive") return <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (type === "savings_opportunity") return <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (type === "forecast") return <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  return <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />;
}


// ── Drilldown types ────────────────────────────────────────────────────────

type DrillType = "income" | "expenses" | "investments" | "offset" | "free-cash";

interface DrillState {
  type: DrillType;
  startDate?: string;
  endDate?: string;
  label: string;
  initialCategory?: string;
  freeCashBreakdown?: { income: number; expenses: number; investments: number; mortgageGoalOffset: number; freeCash: number };
}

interface CategoryRow {
  category: string;
  amount: number;
  count: number;
  percentage: number;
}

// ── Category Picker Button ────────────────────────────────────────────────

function CategoryPickerButton({
  txId,
  currentCategory,
  allCategories,
  onCategoryChange,
  onDone,
  isLoading,
}: {
  txId: string;
  currentCategory: string | null;
  allCategories: string[];
  onCategoryChange: (txId: string, newCat: string) => void;
  onDone: (txId: string, newCat: string, oldCat: string | null) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = (cat: string) => {
    if (cat === currentCategory) { setOpen(false); return; }
    onCategoryChange(txId, cat);
    onDone(txId, cat, currentCategory);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="group flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/30 px-2 py-0.5 rounded text-xs transition-colors"
          title="Click to recategorise"
          disabled={isLoading}
        >
          <span className="truncate max-w-[100px]">{currentCategory ?? "—"}</span>
          <ChevronsUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No category found</CommandEmpty>
            <CommandGroup>
              {allCategories.map((cat) => (
                <CommandItem
                  key={cat}
                  value={cat}
                  onSelect={() => handleSelect(cat)}
                  className="text-xs cursor-pointer"
                  disabled={isLoading}
                >
                  <Check className={`mr-1.5 h-3 w-3 ${cat === currentCategory ? "opacity-100" : "opacity-0"}`} />
                  {cat}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Category drilldown sheet ───────────────────────────────────────────────

function DrillDownSheet({
  drill,
  onClose,
}: {
  drill: DrillState | null;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateTransaction();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [catLoading, setCatLoading] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialogState | null>(null);
  const [offsetTxs, setOffsetTxs] = useState<any[]>([]);
  const [offsetNetFlow, setOffsetNetFlow] = useState(0);

  // Transactions level state
  const [txPage, setTxPage] = useState(1);
  const TX_LIMIT = 15;

  const isCategoryDrillType = drill?.type === "income" || drill?.type === "expenses" || drill?.type === "investments";

  const txParams = selectedCategory && drill && isCategoryDrillType
    ? {
        page: txPage,
        limit: TX_LIMIT,
        category: selectedCategory,
        creditDebit: drill.type === "income" ? ("credit" as const) : ("debit" as const),
        startDate: drill.startDate,
        endDate: drill.endDate,
        isTransfer: false as const,
        ...(drill.type === "investments" ? { isInvestment: true as const } : { isInvestment: false as const }),
      }
    : null;

  const txQuery = useListTransactions(
    txParams ?? { page: 1, limit: TX_LIMIT },
    {
      query: {
        queryKey: getListTransactionsQueryKey(txParams ?? { page: 1, limit: TX_LIMIT }),
        enabled: !!txParams,
      },
    }
  );

  // Fetch all available categories on mount
  useEffect(() => {
    fetch(`${BASE}api/transactions/categories`)
      .then((r) => r.json())
      .then((d) => setAllCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  // Fetch categories when drill state changes (income/expenses/investments only)
  useEffect(() => {
    if (!drill || !isCategoryDrillType) { setCategories([]); setSelectedCategory(null); setCatSearch(""); setCatLoading(false); return; }
    setCatLoading(true);
    setSelectedCategory(drill.initialCategory ?? null);
    setTxPage(1);
    setCatSearch("");
    const params = new URLSearchParams({ type: drill.type });
    if (drill.startDate) params.set("startDate", drill.startDate);
    if (drill.endDate) params.set("endDate", drill.endDate);
    fetch(`${BASE}api/dashboard/category-drilldown?${params}`)
      .then((r) => r.json())
      .then((d) => { setCategories(d.categories ?? []); setTotal(d.total ?? 0); })
      .catch(() => {})
      .finally(() => setCatLoading(false));
  }, [drill]);

  // Fetch offset transactions when type=offset
  useEffect(() => {
    if (!drill || drill.type !== "offset") { setOffsetTxs([]); setOffsetNetFlow(0); return; }
    const params = new URLSearchParams();
    if (drill.startDate) params.set("startDate", drill.startDate);
    if (drill.endDate) params.set("endDate", drill.endDate);
    fetch(`${BASE}api/dashboard/offset-drilldown?${params}`)
      .then((r) => r.json())
      .then((d) => { setOffsetTxs(d.transactions ?? []); setOffsetNetFlow(d.netFlow ?? 0); })
      .catch(() => {});
  }, [drill]);

  // Reset tx page when category changes
  useEffect(() => { setTxPage(1); }, [selectedCategory]);

  const handleCategoryChange = (txId: string, newCat: string) => {
    updateMutation.mutate(
      { id: txId, data: { userCategory: newCat } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(txParams ?? { page: 1, limit: TX_LIMIT }) });
        },
        onError: () => toast({ title: "Failed to update category", variant: "destructive" }),
      }
    );
  };

  const handleCategoryChanged = useCallback(async (txId: string, newCat: string, oldCat: string | null) => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(txParams ?? { page: 1, limit: TX_LIMIT }) });
    try {
      const res = await fetch(`${BASE}api/transactions/${txId}/similar`);
      if (!res.ok) { toast({ title: "Category updated", description: `Recategorised as "${newCat}"` }); return; }
      const data: { source: any; defaultCriteria: MatchCriterion[]; results: any } = await res.json();
      if (data.results.count > 0) {
        setBulkDialog({ txId, oldCategory: oldCat, newCategory: newCat, source: data.source, defaultCriteria: data.defaultCriteria, results: data.results });
      } else {
        toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
      }
    } catch {
      toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
    }
  }, [queryClient, toast, txParams]);

  const handleBulkApply = async (criteria: MatchCriterion[], createRule: boolean) => {
    if (!bulkDialog) return;
    const { txId, newCategory } = bulkDialog;
    const res = await fetch(`${BASE}api/transactions/bulk-recategorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId, criteria, newCategory, createRule }),
    });
    const data = await res.json();
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(txParams ?? { page: 1, limit: TX_LIMIT }) });
    toast({
      title: `Updated ${data.updated} transactions`,
      description: createRule
        ? `Recategorised as "${newCategory}" and created a rule for future imports`
        : `Recategorised as "${newCategory}"`,
    });
    setBulkDialog(null);
  };

  if (!drill) return null;

  const isIncome = drill.type === "income";
  const isInvestments = drill.type === "investments";
  const isOffset = drill.type === "offset";
  const isFreeCash = drill.type === "free-cash";
  const accentColor = isIncome ? "text-emerald-400" : isInvestments ? "text-violet-400" : isOffset ? "text-cyan-400" : isFreeCash ? "text-blue-400" : "text-red-400";
  const barColor = isIncome ? "#10b981" : isInvestments ? "#8b5cf6" : "#ef4444";

  const drillLabel = isIncome ? "Income" : isInvestments ? "Investments" : isOffset ? "Mortgage Goal Offset" : isFreeCash ? "Free Cash" : "Expenses";

  const filteredCats = catSearch
    ? categories.filter((c) => c.category.toLowerCase().includes(catSearch.toLowerCase()))
    : categories;

  const txs = txQuery.data?.transactions ?? [];
  const txTotal = txQuery.data?.total ?? 0;
  const txTotalPages = txQuery.data?.totalPages ?? 1;

  const selectedCatData = categories.find((c) => c.category === selectedCategory);

  // Build query string for the "View all" link
  const viewAllParams = new URLSearchParams();
  if (selectedCategory) viewAllParams.set("category", selectedCategory);
  viewAllParams.set("creditDebit", isIncome ? "credit" : "debit");
  if (isInvestments) {
    viewAllParams.set("isInvestment", "true");
  } else if (!isIncome) {
    viewAllParams.set("isTransfer", "false");
    viewAllParams.set("isInvestment", "false");
  }
  if (drill.startDate) viewAllParams.set("startDate", drill.startDate);
  if (drill.endDate) viewAllParams.set("endDate", drill.endDate);

  return (
    <>
      <Sheet open={!!drill} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0 gap-0">
          {/* ── Header ───────────────────────────────────────────── */}
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`hover:text-foreground transition-colors ${!selectedCategory ? "text-foreground font-medium" : ""}`}
              >
                {drillLabel}
              </button>
              {selectedCategory && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span className="text-foreground font-medium truncate max-w-[180px]">{selectedCategory}</span>
                </>
              )}
            </div>

          <SheetTitle className="text-base leading-tight">
            {selectedCategory ? (
              <span className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {selectedCategory}
              </span>
            ) : (
              `${drillLabel} — ${drill.label}`
            )}
          </SheetTitle>

          {/* Summary line */}
          <p className="text-xs text-muted-foreground">
            {isCategoryDrillType && (selectedCategory && selectedCatData
              ? <>
                  <span className={`font-semibold ${accentColor}`}>{formatCurrency(selectedCatData.amount)}</span>
                  {" · "}{selectedCatData.count} transactions{" · "}
                  {selectedCatData.percentage.toFixed(1)}% of {drillLabel.toLowerCase()}
                </>
              : <>
                  <span className={`font-semibold ${accentColor}`}>{formatCurrency(total)}</span>
                  {" · "}{categories.reduce((s, c) => s + c.count, 0)} transactions{" · "}
                  {categories.length} categories
                </>
            )}
            {isOffset && (
              <>Net flow: <span className={`font-semibold ${offsetNetFlow >= 0 ? "text-cyan-400" : "text-red-400"}`}>{formatCurrency(offsetNetFlow)}</span></>
            )}
            {isFreeCash && drill.freeCashBreakdown && (
              <span className={`font-semibold ${accentColor}`}>{formatCurrency(drill.freeCashBreakdown.freeCash)}</span>
            )}
          </p>
        </SheetHeader>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Offset: transaction list ─────────────────────── */}
          {isOffset && (
            <div className="px-5 py-4 space-y-1">
              {offsetTxs.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-8">No transactions found</p>
                : offsetTxs.map((tx: any) => {
                    const amount = parseFloat(tx.amount);
                    const isCredit = tx.creditDebit === "credit";
                    return (
                      <div key={tx.id} className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-muted/40 transition-colors border-b border-border last:border-0">
                        <div className="flex-shrink-0 w-16 text-right">
                          <span className="text-xs text-muted-foreground">{tx.transactionDate}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{tx.description}</p>
                        </div>
                        <div className="flex-shrink-0 w-24 text-right">
                          <span className={`text-sm font-semibold tabular-nums ${isCredit ? "text-cyan-400" : "text-red-400"}`}>
                            {isCredit ? "+" : "-"}{formatCurrencyFull(amount)}
                          </span>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          )}

          {/* ── Free Cash: derivation breakdown ──────────────── */}
          {isFreeCash && drill.freeCashBreakdown && (
            <div className="px-5 py-6 space-y-4">
              <p className="text-xs text-muted-foreground">How free cash is calculated for {drill.label}:</p>
              <div className="space-y-2 text-sm">
                {[
                  { label: "Income", value: drill.freeCashBreakdown.income, color: "text-emerald-400", sign: "+" },
                  { label: "Expenses", value: drill.freeCashBreakdown.expenses, color: "text-red-400", sign: "−" },
                  { label: "Investments", value: drill.freeCashBreakdown.investments, color: "text-violet-400", sign: "−" },
                  { label: "Mortgage Goal Offset", value: drill.freeCashBreakdown.mortgageGoalOffset, color: "text-cyan-400", sign: "−" },
                ].map(({ label, value, color, sign }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-border">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-semibold tabular-nums ${color}`}>{sign} {formatCurrency(value)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <span className="font-semibold text-foreground">Free Cash</span>
                  <span className={`font-semibold tabular-nums ${drill.freeCashBreakdown.freeCash >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    = {formatCurrency(drill.freeCashBreakdown.freeCash)}
                  </span>
                </div>
                {drill.freeCashBreakdown.freeCash < 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Negative free cash means your mortgage goal and spending commitments exceeded income this month — you drew down the offset buffer.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Level 1: Categories ─────────────────────────── */}
          {isCategoryDrillType && !selectedCategory && (
            <div className="px-5 py-4 space-y-3">
              {/* Search */}
              <input
                type="text"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
                placeholder={`Search ${isIncome ? "income sources" : isInvestments ? "investment categories" : "expense categories"}…`}
                className="w-full h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />

              {catLoading ? (
                <div className="space-y-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : filteredCats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No categories found</p>
              ) : (
                <div className="space-y-1">
                  {filteredCats.map((cat, i) => (
                    <button
                      key={cat.category}
                      onClick={() => setSelectedCategory(cat.category)}
                      className="w-full text-left group rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors border border-transparent hover:border-border"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {cat.category}
                          </span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {cat.count} txns
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-sm font-semibold tabular-nums ${accentColor}`}>
                            {formatCurrency(cat.amount)}
                          </span>
                          <span className="text-xs text-muted-foreground w-9 text-right">
                            {cat.percentage.toFixed(0)}%
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${cat.percentage}%`,
                            background: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* View all link */}
              <div className="pt-2 border-t border-border">
                <Link
                  href={`/transactions?creditDebit=${isIncome ? "credit" : "debit"}${isInvestments ? "&isInvestment=true" : ""}${drill.startDate ? `&startDate=${drill.startDate}` : ""}${drill.endDate ? `&endDate=${drill.endDate}` : ""}`}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  onClick={onClose}
                >
                  <ExternalLink className="w-3 h-3" />
                  View all {drillLabel.toLowerCase()} transactions
                </Link>
              </div>
            </div>
          )}

          {/* ── Level 2: Transactions ─────────────────────────── */}
          {isCategoryDrillType && selectedCategory && (
            <div className="px-5 py-4 space-y-2">
              {txQuery.isLoading ? (
                <div className="space-y-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : txs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No transactions found</p>
              ) : (
                <>
                  <div className="space-y-0.5">
                    {txs.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-muted/40 transition-colors border-b border-border last:border-0"
                      >
                        {/* Date */}
                        <div className="flex-shrink-0 w-16 text-right">
                          <span className="text-xs text-muted-foreground">{tx.transactionDate}</span>
                        </div>
                        {/* Description */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {tx.userDescription ?? tx.description}
                          </p>
                          {tx.merchantName && tx.merchantName !== "Unknown" && (
                            <p className="text-xs text-muted-foreground truncate">{tx.merchantName}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{tx.accountName}</p>
                        </div>
                        {/* Category Picker */}
                        <div className="flex-shrink-0">
                          <CategoryPickerButton
                            txId={tx.id}
                            currentCategory={tx.userCategory ?? tx.categoryName}
                            allCategories={allCategories}
                            onCategoryChange={handleCategoryChange}
                            onDone={handleCategoryChanged}
                            isLoading={updateMutation.isPending}
                          />
                        </div>
                        {/* Amount */}
                        <div className="flex-shrink-0 w-20 text-right">
                          <span className={`text-sm font-semibold tabular-nums ${isIncome ? "text-emerald-400" : isInvestments ? "text-violet-400" : "text-foreground"}`}>
                            {isIncome ? "+" : "-"}{formatCurrencyFull(tx.amount)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {txTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                      <span>{txTotal} transactions · page {txPage} of {txTotalPages}</span>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                          disabled={txPage === 1}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
                          disabled={txPage === txTotalPages}
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* View all link */}
                  <div className="pt-2 border-t border-border">
                    <Link
                      href={`/transactions?category=${encodeURIComponent(selectedCategory)}&creditDebit=${isIncome ? "credit" : "debit"}${isInvestments ? "&isInvestment=true" : ""}`}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      onClick={onClose}
                    >
                      <ExternalLink className="w-3 h-3" />
                      View all "{selectedCategory}" transactions in full view
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
      </Sheet>
      <BulkApplyDialog
        state={bulkDialog}
        onClose={() => setBulkDialog(null)}
        onApply={handleBulkApply}
      />
    </>
  );
}

// ── Clickable metric card ──────────────────────────────────────────────────

function ChangePill({ change, invert = false }: { change: number; invert?: boolean }) {
  const isUp = change > 0;
  const isGood = invert ? !isUp : isUp;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
      isGood ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
    }`}>
      {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  positive,
  onClick,
  hint,
  change,
  invertChange,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  positive?: boolean;
  onClick?: () => void;
  hint?: string;
  change?: number;
  invertChange?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card border border-card-border rounded-lg p-4 flex flex-col gap-1 ${
        onClick ? "cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors group" : ""
      }`}
      title={hint}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        {onClick && (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
        )}
      </div>
      <span className={`text-2xl font-bold tabular-nums ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-foreground"}`}>
        {value}
      </span>
      <div className="flex items-center gap-1.5 min-h-[18px]">
        {change !== undefined && <ChangePill change={change} invert={invertChange} />}
        {change !== undefined && <span className="text-[10px] text-muted-foreground/50">vs last month</span>}
        {!change && sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      {onClick && (
        <span className="text-xs text-muted-foreground/50 group-hover:text-primary/70 transition-colors">
          Click to drill in →
        </span>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const [activeMode, setActiveMode] = useState<ActiveMode>("month-nav");
  const [navMonth, setNavMonth] = useState<string>(getCurrentMonth());
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [drill, setDrill] = useState<DrillState | null>(null);

  const isMonthNav = activeMode === "month-nav";
  const isCustom = activeMode === "custom";

  const dateRange = (() => {
    if (isMonthNav) return getMonthDateRange(navMonth);
    if (isCustom) return { startDate: customStart || undefined, endDate: customEnd || undefined };
    return getPresetRange(activeMode);
  })();

  const selectedLabel = (() => {
    if (isMonthNav) return navMonthLabel(navMonth);
    if (isCustom && (customStart || customEnd)) return `${customStart ?? "?"} → ${customEnd ?? "?"}`;
    return getPresetLabel(activeMode);
  })();

  // Compare to prior month when viewing a single month
  const showComparison = isMonthNav;
  const prevRange = isMonthNav ? getMonthDateRange(stepNavMonth(navMonth, -1)) : null;

  const summaryParams = { startDate: dateRange.startDate, endDate: dateRange.endDate };
  const summary = useGetDashboardSummary(summaryParams, {
    query: { queryKey: getGetDashboardSummaryQueryKey(summaryParams) },
  });

  const prevSummaryParams = prevRange ?? {};
  const prevSummary = useGetDashboardSummary(prevSummaryParams, {
    query: {
      queryKey: getGetDashboardSummaryQueryKey(prevSummaryParams),
      enabled: !!prevRange,
    },
  });

  const cashflowParams = { startDate: dateRange.startDate, endDate: dateRange.endDate };
  const cashflow = useGetCashflow(cashflowParams, {
    query: { queryKey: getGetCashflowQueryKey(cashflowParams) },
  });

  const catParams = { startDate: dateRange.startDate, endDate: dateRange.endDate };
  const categories = useGetSpendingByCategory(catParams, {
    query: { queryKey: getGetSpendingByCategoryQueryKey(catParams) },
  });
  const accounts = useGetAccounts({ query: { queryKey: getGetAccountsQueryKey() } });
  const forecast = useGetForecast({ query: { queryKey: getGetForecastQueryKey() } });
  const insights = useGetAiInsights({ query: { queryKey: getGetAiInsightsQueryKey() } });
  const recentTx = useListTransactions({ limit: 5, page: 1 }, {
    query: { queryKey: getListTransactionsQueryKey({ limit: 5, page: 1 }) },
  });

  const s = summary.data;
  const f = forecast.data;

  const rawMonths = cashflow.data?.months ?? [];
  const incomeTrend = linearTrend(rawMonths.map((m) => m.income));
  const expenseTrend = linearTrend(rawMonths.map((m) => m.expenses));
  const investmentCategories = [...new Set(rawMonths.flatMap((m) => Object.keys(m.investmentBreakdown ?? {})))];
  const INVEST_COLORS = ["#8b5cf6", "#a78bfa", "#c4b5fd", "#7c3aed", "#6d28d9"];

  const cashflowData = rawMonths.map((m, i) => {
    const invBreakdown = m.investmentBreakdown ?? {};
    const invEntries = investmentCategories.reduce((acc, cat) => { acc[cat] = invBreakdown[cat] ?? 0; return acc; }, {} as Record<string, number>);
    return {
      month: m.month.substring(5),
      fullMonth: m.month,
      Income: m.income,
      Expenses: m.expenses,
      "Mortgage Goal": m.mortgageGoalOffset ?? 0,
      "Free Cash": m.freeCash ?? 0,
      IncomeTrend: incomeTrend[i],
      ExpensesTrend: expenseTrend[i],
      ...invEntries,
    };
  });

  const pieData = (categories.data?.categories ?? []).slice(0, 7).map((c, i) => ({
    name: c.category,
    value: parseFloat(c.amount.toFixed(2)),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  function openDrill(type: DrillType) {
    setDrill({
      type,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      label: selectedLabel,
    });
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Command Centre</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{selectedLabel}</p>
          </div>
          {f && (
            <div className="text-right bg-card border border-card-border rounded-lg px-4 py-2 hidden lg:block">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Forecast</p>
              <p className="text-sm font-semibold text-foreground">{f.onTrackMessage}</p>
            </div>
          )}
        </div>

        {/* Date range filter bar */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />

            {/* ── Month navigator ── */}
            <button
              onClick={() => { setNavMonth(m => stepNavMonth(m, -1)); setActiveMode("month-nav"); }}
              className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              title="Previous month"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setActiveMode("month-nav")}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors whitespace-nowrap ${
                isMonthNav
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 bg-transparent"
              }`}
            >
              {navMonthLabel(navMonth)}
            </button>
            <button
              onClick={() => { setNavMonth(m => stepNavMonth(m, 1)); setActiveMode("month-nav"); }}
              className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={navMonth >= getCurrentMonth()}
              title="Next month"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {/* ── Divider ── */}
            <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />

            {/* ── Multi-period presets ── */}
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveMode(p.id)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors whitespace-nowrap ${
                  activeMode === p.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 bg-transparent"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {isCustom && (
            <div className="flex items-center gap-2 pl-5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      </div>

      {f && (
        <div className="bg-card border border-card-border rounded-lg px-4 py-2 lg:hidden">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Forecast</p>
          <p className="text-sm font-semibold text-foreground">{f.onTrackMessage}</p>
        </div>
      )}

      {/* KPI Row */}
      {summary.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard
            label="Total Income"
            value={formatCurrency(s?.totalIncome ?? 0)}
            positive={true}
            onClick={() => openDrill("income")}
            hint="Click to see income by category"
            change={showComparison && prevSummary.data ? pctChange(s?.totalIncome ?? 0, prevSummary.data.totalIncome) : undefined}
          />
          <MetricCard
            label="Total Expenses"
            value={formatCurrency(s?.totalExpenses ?? 0)}
            positive={false}
            onClick={() => openDrill("expenses")}
            hint="Click to see expenses by category"
            change={showComparison && prevSummary.data ? pctChange(s?.totalExpenses ?? 0, prevSummary.data.totalExpenses) : undefined}
            invertChange
          />
          <MetricCard
            label="Total Invested"
            value={formatCurrency(s?.totalInvested ?? 0)}
            positive={true}
            onClick={() => openDrill("investments")}
            hint="Click to see investments by category"
            change={showComparison && prevSummary.data ? pctChange(s?.totalInvested ?? 0, prevSummary.data.totalInvested) : undefined}
          />
          <MetricCard
            label="Net Cashflow"
            value={formatCurrency(s?.netCashflow ?? 0)}
            positive={(s?.netCashflow ?? 0) >= 0}
            change={showComparison && prevSummary.data ? pctChange(s?.netCashflow ?? 0, prevSummary.data.netCashflow) : undefined}
          />
          <MetricCard
            label="Savings Rate"
            value={`${(s?.savingsRate ?? 0).toFixed(1)}%`}
            sub={
              <a
                href="/transactions?tab=transfers"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                {s?.transfersFiltered ?? 0} transfers excluded →
              </a>
            }
            positive={(s?.savingsRate ?? 0) >= 15}
            change={showComparison && prevSummary.data ? pctChange(s?.savingsRate ?? 0, prevSummary.data.savingsRate) : undefined}
          />
        </div>
      )}

      {/* Cashflow Chart + AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cash Flow — {selectedLabel}</h2>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Click income or expense bar to drill in</p>
            </div>
            {cashflow.data && (
              <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                <div className="flex gap-4">
                  <span>Avg Income <span className="text-emerald-400 font-semibold">{formatCurrency(cashflow.data.averageIncome)}</span></span>
                  <span>Avg Expenses <span className="text-red-400 font-semibold">{formatCurrency(cashflow.data.averageExpenses)}</span></span>
                </div>
                {rawMonths.length >= 3 && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2"/></svg>
                      income trend
                    </span>
                    <span className="flex items-center gap-1">
                      <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 2"/></svg>
                      expense trend
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          {cashflow.isLoading ? (
            <div className="h-56 animate-pulse bg-muted rounded" />
          ) : cashflowData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
              No transaction data yet — import a CSV to get started
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={cashflowData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={(props) => {
                    const { x, y, payload } = props;
                    return (
                      <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
                        {payload.value}
                      </text>
                    );
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(v: number, name: string) => {
                    if (name === "IncomeTrend" || name === "ExpensesTrend") return null;
                    return formatCurrency(v);
                  }}
                />
                <Bar
                  dataKey="Income"
                  fill="#10b981"
                  radius={[2, 2, 0, 0]}
                  style={{ cursor: "pointer" }}
                  onClick={(d: any) => {
                    const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                    setDrill({ type: "income", startDate, endDate, label: d.fullMonth });
                  }}
                />
                <Bar
                  dataKey="Expenses"
                  fill="#ef4444"
                  radius={[2, 2, 0, 0]}
                  style={{ cursor: "pointer" }}
                  onClick={(d: any) => {
                    const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                    setDrill({ type: "expenses", startDate, endDate, label: d.fullMonth });
                  }}
                />
                {investmentCategories.map((cat, ci) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="inv"
                    fill={INVEST_COLORS[ci % INVEST_COLORS.length]}
                    radius={ci === investmentCategories.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                    style={{ cursor: "pointer" }}
                    onClick={(d: any) => {
                      const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                      setDrill({ type: "investments", startDate, endDate, label: d.fullMonth, initialCategory: cat });
                    }}
                  />
                ))}
                <Bar
                  dataKey="Mortgage Goal"
                  stackId="sav"
                  fill="#06b6d4"
                  radius={[0, 0, 0, 0]}
                  style={{ cursor: "pointer" }}
                  onClick={(d: any) => {
                    const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                    setDrill({ type: "offset", startDate, endDate, label: d.fullMonth });
                  }}
                />
                <Bar
                  dataKey="Free Cash"
                  stackId="sav"
                  fill="#3b82f6"
                  radius={[2, 2, 0, 0]}
                  style={{ cursor: "pointer" }}
                  onClick={(d: any) => {
                    const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                    const monthData = rawMonths.find((m) => m.month === d.fullMonth);
                    setDrill({
                      type: "free-cash",
                      startDate,
                      endDate,
                      label: d.fullMonth,
                      freeCashBreakdown: {
                        income: monthData?.income ?? 0,
                        expenses: monthData?.expenses ?? 0,
                        investments: monthData?.investments ?? 0,
                        mortgageGoalOffset: monthData?.mortgageGoalOffset ?? 0,
                        freeCash: monthData?.freeCash ?? 0,
                      },
                    });
                  }}
                />
                {rawMonths.length >= 3 && (
                  <>
                    <Line dataKey="IncomeTrend" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 3" type="linear" legendType="none" />
                    <Line dataKey="ExpensesTrend" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 3" type="linear" legendType="none" />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">AI Insights</h2>
            <Link href="/ai-advisor" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ask CFO <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {insights.isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-muted rounded" />)}
            </div>
          ) : (insights.data?.insights ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Import transactions to unlock AI insights</p>
          ) : (
            <div className="space-y-3">
              {(insights.data?.insights ?? []).map((insight) => (
                <div key={insight.id} className="flex gap-2.5 p-3 bg-muted/40 rounded-lg border border-border">
                  <InsightIcon type={insight.type} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground leading-tight">{insight.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spending Categories + Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spending by Category — clickable slices */}
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Spending by Category — {selectedLabel}
            </h2>
            <button
              onClick={() => openDrill("expenses")}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {categories.isLoading ? (
            <div className="h-48 animate-pulse bg-muted rounded" />
          ) : pieData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No expense data</div>
          ) : (
            <div className="flex gap-4 items-center">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    dataKey="value"
                    paddingAngle={2}
                    onClick={(entry: any) => {
                      setDrill({
                        type: "expenses",
                        startDate: dateRange?.startDate,
                        endDate: dateRange?.endDate,
                        label: selectedLabel,
                        initialCategory: entry?.name,
                      });
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {pieData.slice(0, 6).map((c, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setDrill({
                        type: "expenses",
                        startDate: dateRange?.startDate,
                        endDate: dateRange?.endDate,
                        label: selectedLabel,
                        initialCategory: c.name,
                      });
                    }}
                    className="w-full flex items-center justify-between text-xs hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      <span className="text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-[90px]">{c.name}</span>
                    </div>
                    <span className="font-semibold text-foreground tabular-nums">{formatCurrency(c.value)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Accounts */}
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Accounts</h2>
            <span className="text-xs text-muted-foreground/60">Click to drill in</span>
          </div>
          {accounts.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 animate-pulse bg-muted rounded" />)}
            </div>
          ) : (accounts.data?.accounts ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No accounts found</div>
          ) : (
            <div className="space-y-1">
              {(accounts.data?.accounts ?? []).map((acc, i) => (
                <Link
                  key={i}
                  href={`/transactions?account=${encodeURIComponent(acc.accountName)}`}
                  className="flex items-center justify-between py-2 px-2 -mx-2 border-b border-border last:border-0 rounded hover:bg-muted/40 cursor-pointer transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">{acc.accountName}</p>
                    <p className="text-xs text-muted-foreground">{acc.providerName} · {acc.transactionCount} txns</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-emerald-400 tabular-nums">{formatCurrency(acc.totalCredits)} in</p>
                    <p className="text-xs text-red-400 tabular-nums">{formatCurrency(acc.totalDebits)} out</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent Transactions</h2>
          <Link href="/transactions" className="text-xs text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {recentTx.isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-8 animate-pulse bg-muted rounded" />)}</div>
        ) : (
          <div className="space-y-1">
            {(recentTx.data?.transactions ?? []).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{tx.userDescription ?? tx.description}</p>
                  <p className="text-xs text-muted-foreground">{tx.transactionDate} · {tx.categoryName ?? "Uncategorised"}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {tx.isTransfer && <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">Transfer</span>}
                  <span className={`text-sm font-semibold tabular-nums ${tx.creditDebit === "credit" ? "text-emerald-400" : "text-foreground"}`}>
                    {tx.creditDebit === "debit" ? "-" : "+"}{formatCurrency(tx.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drill-down sheet */}
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
