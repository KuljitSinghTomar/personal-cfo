import { useState, useEffect } from "react";
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
} from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, ArrowRight, AlertTriangle, Lightbulb, Info, CheckCircle,
  ChevronLeft, ChevronRight, ChevronDown, ExternalLink,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

const CHART_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];
const BASE = import.meta.env.BASE_URL;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}
function formatCurrencyFull(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

function getLast18Months() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = d.toISOString().substring(0, 7);
    const label = d.toLocaleString("en-AU", { month: "long", year: "numeric" });
    months.push({ value, label });
  }
  return months;
}

function getMonthDateRange(month: string) {
  const [year, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year!, m!, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { startDate: start, endDate: end };
}

function getPrevMonthKey(month: string) {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year!, m! - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

const MONTH_OPTIONS = getLast18Months();
const ALL_TIME = "__all__";

// ── Drilldown types ────────────────────────────────────────────────────────

type DrillType = "income" | "expenses";

interface DrillState {
  type: DrillType;
  startDate?: string;
  endDate?: string;
  label: string;
  initialCategory?: string;
}

interface CategoryRow {
  category: string;
  amount: number;
  count: number;
  percentage: number;
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [catLoading, setCatLoading] = useState(false);
  const [catSearch, setCatSearch] = useState("");

  // Transactions level state
  const [txPage, setTxPage] = useState(1);
  const TX_LIMIT = 15;

  const txParams = selectedCategory && drill
    ? {
        page: txPage,
        limit: TX_LIMIT,
        category: selectedCategory,
        creditDebit: drill.type === "income" ? ("credit" as const) : ("debit" as const),
        startDate: drill.startDate,
        endDate: drill.endDate,
        isTransfer: false as const,
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

  // Fetch categories when drill state changes
  useEffect(() => {
    if (!drill) { setCategories([]); setSelectedCategory(null); setCatSearch(""); return; }
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

  // Reset tx page when category changes
  useEffect(() => { setTxPage(1); }, [selectedCategory]);

  if (!drill) return null;

  const isIncome = drill.type === "income";
  const accentColor = isIncome ? "text-emerald-400" : "text-red-400";
  const barColor = isIncome ? "#10b981" : "#ef4444";

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
  if (drill.startDate) viewAllParams.set("startDate", drill.startDate);
  if (drill.endDate) viewAllParams.set("endDate", drill.endDate);

  return (
    <Sheet open={!!drill} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 gap-0"
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`hover:text-foreground transition-colors ${!selectedCategory ? "text-foreground font-medium" : ""}`}
            >
              {isIncome ? "Income" : "Expenses"}
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
              `${isIncome ? "Income" : "Expenses"} — ${drill.label}`
            )}
          </SheetTitle>

          {/* Summary line */}
          <p className="text-xs text-muted-foreground">
            {selectedCategory && selectedCatData
              ? <>
                  <span className={`font-semibold ${accentColor}`}>{formatCurrency(selectedCatData.amount)}</span>
                  {" · "}{selectedCatData.count} transactions{" · "}
                  {selectedCatData.percentage.toFixed(1)}% of {isIncome ? "income" : "expenses"}
                </>
              : <>
                  <span className={`font-semibold ${accentColor}`}>{formatCurrency(total)}</span>
                  {" · "}{categories.reduce((s, c) => s + c.count, 0)} transactions{" · "}
                  {categories.length} categories
                </>
            }
          </p>
        </SheetHeader>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Level 1: Categories ─────────────────────────── */}
          {!selectedCategory && (
            <div className="px-5 py-4 space-y-3">
              {/* Search */}
              <input
                type="text"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
                placeholder={`Search ${isIncome ? "income sources" : "expense categories"}…`}
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
                  href={`/transactions?creditDebit=${isIncome ? "credit" : "debit"}${drill.startDate ? `&startDate=${drill.startDate}` : ""}${drill.endDate ? `&endDate=${drill.endDate}` : ""}`}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  onClick={onClose}
                >
                  <ExternalLink className="w-3 h-3" />
                  View all {isIncome ? "income" : "expense"} transactions
                </Link>
              </div>
            </div>
          )}

          {/* ── Level 2: Transactions ─────────────────────────── */}
          {selectedCategory && (
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
                        <div className="flex-shrink-0 w-20 text-right">
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
                        {/* Amount */}
                        <div className="flex-shrink-0 text-right">
                          <span className={`text-sm font-semibold tabular-nums ${isIncome ? "text-emerald-400" : "text-foreground"}`}>
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
                      href={`/transactions?category=${encodeURIComponent(selectedCategory)}&creditDebit=${isIncome ? "credit" : "debit"}`}
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
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_TIME);
  const [drill, setDrill] = useState<DrillState | null>(null);

  const isMonthly = selectedMonth !== ALL_TIME;
  const dateRange = isMonthly ? getMonthDateRange(selectedMonth) : undefined;
  const summaryParams = dateRange ?? {};

  const summary = useGetDashboardSummary(summaryParams, {
    query: { queryKey: getGetDashboardSummaryQueryKey(summaryParams) },
  });

  const prevMonthKey = isMonthly ? getPrevMonthKey(selectedMonth) : null;
  const prevMonthRange = prevMonthKey ? getMonthDateRange(prevMonthKey) : null;
  const prevSummaryParams = prevMonthRange ?? {};
  const prevSummary = useGetDashboardSummary(prevSummaryParams, {
    query: {
      queryKey: getGetDashboardSummaryQueryKey(prevSummaryParams),
      enabled: !!prevMonthRange,
    },
  });
  const cashflow = useGetCashflow({ months: 12 }, {
    query: { queryKey: getGetCashflowQueryKey({ months: 12 }) },
  });
  const catParams = dateRange ?? {};
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

  const currentMonthIdx = MONTH_OPTIONS.findIndex((m) => m.value === selectedMonth);
  const canGoBack = currentMonthIdx < MONTH_OPTIONS.length - 1;
  const canGoForward = isMonthly && currentMonthIdx > 0;

  function stepMonth(dir: 1 | -1) {
    if (selectedMonth === ALL_TIME) { setSelectedMonth(MONTH_OPTIONS[0]!.value); return; }
    const next = MONTH_OPTIONS[currentMonthIdx - dir];
    if (next) setSelectedMonth(next.value); else setSelectedMonth(ALL_TIME);
  }

  const cashflowData = (cashflow.data?.months ?? []).map((m) => ({
    month: m.month.substring(5),
    fullMonth: m.month,
    Income: m.income,
    Expenses: m.expenses,
    Savings: m.savings,
  }));

  const pieData = (categories.data?.categories ?? []).slice(0, 7).map((c, i) => ({
    name: c.category,
    value: parseFloat(c.amount.toFixed(2)),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const selectedLabel = isMonthly
    ? MONTH_OPTIONS.find((m) => m.value === selectedMonth)?.label ?? selectedMonth
    : "Last 12 months";

  function openDrill(type: DrillType) {
    setDrill({
      type,
      startDate: dateRange?.startDate,
      endDate: dateRange?.endDate,
      label: selectedLabel,
    });
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Command Centre</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isMonthly ? selectedLabel : (s?.periodLabel ?? "Loading...")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => stepMonth(-1)} disabled={!canGoBack} title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TIME}>Last 12 months</SelectItem>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => stepMonth(1)} disabled={!canGoForward} title="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>

          {!isMonthly && f && (
            <div className="text-right bg-card border border-card-border rounded-lg px-4 py-2 hidden lg:block">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Forecast</p>
              <p className="text-sm font-semibold text-foreground">{f.onTrackMessage}</p>
            </div>
          )}
        </div>
      </div>

      {!isMonthly && f && (
        <div className="bg-card border border-card-border rounded-lg px-4 py-2 lg:hidden">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Forecast</p>
          <p className="text-sm font-semibold text-foreground">{f.onTrackMessage}</p>
        </div>
      )}

      {/* KPI Row */}
      {summary.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Income"
            value={formatCurrency(s?.totalIncome ?? 0)}
            positive={true}
            onClick={() => openDrill("income")}
            hint="Click to see income by category"
            change={isMonthly && prevSummary.data ? pctChange(s?.totalIncome ?? 0, prevSummary.data.totalIncome) : undefined}
          />
          <MetricCard
            label="Total Expenses"
            value={formatCurrency(s?.totalExpenses ?? 0)}
            positive={false}
            onClick={() => openDrill("expenses")}
            hint="Click to see expenses by category"
            change={isMonthly && prevSummary.data ? pctChange(s?.totalExpenses ?? 0, prevSummary.data.totalExpenses) : undefined}
            invertChange
          />
          <MetricCard
            label="Net Cashflow"
            value={formatCurrency(s?.netCashflow ?? 0)}
            positive={(s?.netCashflow ?? 0) >= 0}
            change={isMonthly && prevSummary.data ? pctChange(s?.netCashflow ?? 0, prevSummary.data.netCashflow) : undefined}
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
            change={isMonthly && prevSummary.data ? pctChange(s?.savingsRate ?? 0, prevSummary.data.savingsRate) : undefined}
          />
        </div>
      )}

      {/* Cashflow Chart + AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cash Flow — Last 12 Months</h2>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Click income or expense bar to drill in</p>
            </div>
            {cashflow.data && (
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Avg Income <span className="text-emerald-400 font-semibold">{formatCurrency(cashflow.data.averageIncome)}</span></span>
                <span>Avg Expenses <span className="text-red-400 font-semibold">{formatCurrency(cashflow.data.averageExpenses)}</span></span>
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
              <BarChart data={cashflowData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={(props) => {
                    const { x, y, payload } = props;
                    const isSelected = isMonthly && cashflowData.find((d) => d.month === payload.value)?.fullMonth === selectedMonth;
                    return (
                      <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill={isSelected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"} fontWeight={isSelected ? "bold" : "normal"}>
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
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Bar
                  dataKey="Income"
                  fill="#10b981"
                  radius={[2, 2, 0, 0]}
                  opacity={(d: any) => !isMonthly || d.fullMonth === selectedMonth ? 1 : 0.35}
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
                  opacity={(d: any) => !isMonthly || d.fullMonth === selectedMonth ? 1 : 0.35}
                  style={{ cursor: "pointer" }}
                  onClick={(d: any) => {
                    const { startDate, endDate } = getMonthDateRange(d.fullMonth);
                    setDrill({ type: "expenses", startDate, endDate, label: d.fullMonth });
                  }}
                />
                <Bar dataKey="Savings" fill="#3b82f6" radius={[2, 2, 0, 0]} opacity={(d: any) => !isMonthly || d.fullMonth === selectedMonth ? 1 : 0.35} />
              </BarChart>
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
              Spending by Category{isMonthly ? ` — ${selectedLabel}` : ""}
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
