import { useState } from "react";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, ArrowRight, RefreshCw, AlertTriangle, Lightbulb, Info, CheckCircle } from "lucide-react";
import { Link } from "wouter";

const CHART_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-foreground"}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function InsightIcon({ type }: { type: string }) {
  if (type === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  if (type === "positive") return <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (type === "savings_opportunity") return <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (type === "forecast") return <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  return <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />;
}

export default function Dashboard() {
  const [cashflowMonths] = useState(12);

  const summary = useGetDashboardSummary(undefined, {
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });
  const cashflow = useGetCashflow({ months: cashflowMonths }, {
    query: { queryKey: getGetCashflowQueryKey({ months: cashflowMonths }) },
  });
  const categories = useGetSpendingByCategory(undefined, {
    query: { queryKey: getGetSpendingByCategoryQueryKey() },
  });
  const accounts = useGetAccounts({ query: { queryKey: getGetAccountsQueryKey() } });
  const forecast = useGetForecast({ query: { queryKey: getGetForecastQueryKey() } });
  const insights = useGetAiInsights({ query: { queryKey: getGetAiInsightsQueryKey() } });
  const recentTx = useListTransactions({ limit: 5, page: 1 }, {
    query: { queryKey: getListTransactionsQueryKey({ limit: 5, page: 1 }) },
  });

  const s = summary.data;
  const f = forecast.data;

  const cashflowData = (cashflow.data?.months ?? []).map((m) => ({
    month: m.month.substring(5),
    Income: m.income,
    Expenses: m.expenses,
    Savings: m.savings,
  }));

  const pieData = (categories.data?.categories ?? []).slice(0, 7).map((c, i) => ({
    name: c.category,
    value: parseFloat(c.amount.toFixed(2)),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Command Centre</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{s?.periodLabel ?? "Loading..."}</p>
        </div>
        {f && (
          <div className="text-right bg-card border border-card-border rounded-lg px-4 py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Forecast</p>
            <p className="text-sm font-semibold text-foreground">{f.onTrackMessage}</p>
          </div>
        )}
      </div>

      {/* KPI Row */}
      {summary.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="kpi-grid">
          <MetricCard label="Total Income" value={formatCurrency(s?.totalIncome ?? 0)} positive={true} />
          <MetricCard label="Total Expenses" value={formatCurrency(s?.totalExpenses ?? 0)} positive={false} />
          <MetricCard label="Net Cashflow" value={formatCurrency(s?.netCashflow ?? 0)} positive={(s?.netCashflow ?? 0) >= 0} />
          <MetricCard
            label="Savings Rate"
            value={`${(s?.savingsRate ?? 0).toFixed(1)}%`}
            sub={`${s?.transfersFiltered ?? 0} transfers filtered`}
            positive={(s?.savingsRate ?? 0) >= 15}
          />
        </div>
      )}

      {/* Cashflow Chart + AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cashflow Chart */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-lg p-4" data-testid="cashflow-chart">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cash Flow — Last {cashflowMonths} Months</h2>
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
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Bar dataKey="Income" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Expenses" fill="#ef4444" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Savings" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* AI Insights */}
        <div className="bg-card border border-card-border rounded-lg p-4" data-testid="ai-insights">
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
        {/* Spending by Category */}
        <div className="bg-card border border-card-border rounded-lg p-4" data-testid="spending-categories">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">Spending by Category</h2>
          {categories.isLoading ? (
            <div className="h-48 animate-pulse bg-muted rounded" />
          ) : pieData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No expense data</div>
          ) : (
            <div className="flex gap-4 items-center">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {pieData.slice(0, 6).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      <span className="text-muted-foreground truncate max-w-[90px]">{c.name}</span>
                    </div>
                    <span className="font-semibold text-foreground tabular-nums">{formatCurrency(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Accounts */}
        <div className="bg-card border border-card-border rounded-lg p-4" data-testid="accounts-summary">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">Accounts</h2>
          {accounts.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 animate-pulse bg-muted rounded" />)}
            </div>
          ) : (accounts.data?.accounts ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No accounts found</div>
          ) : (
            <div className="space-y-2">
              {(accounts.data?.accounts ?? []).map((acc, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{acc.accountName}</p>
                    <p className="text-xs text-muted-foreground">{acc.providerName} · {acc.transactionCount} txns</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-emerald-400 tabular-nums">{formatCurrency(acc.totalCredits)} in</p>
                    <p className="text-xs text-red-400 tabular-nums">{formatCurrency(acc.totalDebits)} out</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-card border border-card-border rounded-lg p-4" data-testid="recent-transactions">
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
    </div>
  );
}
