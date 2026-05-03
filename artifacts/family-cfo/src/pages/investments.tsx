import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { TrendingUp, ArrowUpRight, Building2, Briefcase, Calendar, BarChart2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}
function formatCurrencyFull(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

const COLORS = [
  "#8b5cf6", "#a78bfa", "#6d28d9", "#7c3aed",
  "#3b82f6", "#60a5fa", "#1d4ed8",
  "#10b981", "#34d399", "#059669",
  "#f59e0b", "#fbbf24",
  "#ef4444", "#f87171",
];

const SUPER_COLOR = "#8b5cf6";
const SHARES_COLOR = "#3b82f6";

interface Fund {
  name: string;
  amount: number;
  count: number;
  lastContribution: string;
  type: string;
  percentage: number;
}

interface MonthlyPoint {
  month: string;
  total: number;
  superAmt: number;
  sharesAmt: number;
}

interface PortfolioData {
  totalInvested: number;
  superTotal: number;
  sharesTotal: number;
  avgMonthly: number;
  transactionCount: number;
  funds: Fund[];
  monthlyHistory: MonthlyPoint[];
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-foreground",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
        <Icon className={`w-4 h-4 ${color} opacity-60`} />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  if (type === "super") {
    return (
      <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded text-xs">
        <Building2 className="w-2.5 h-2.5" /> Super
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-xs">
      <Briefcase className="w-2.5 h-2.5" /> Shares / ETF
    </span>
  );
}

export default function Investments() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartView, setChartView] = useState<"total" | "split">("split");

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}api/investments/portfolio`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const monthlyChartData = (data?.monthlyHistory ?? []).map((m) => ({
    month: m.month.substring(5),
    fullMonth: m.month,
    Super: m.superAmt,
    Shares: m.sharesAmt,
    Total: m.total,
  }));

  const pieData = (data?.funds ?? []).slice(0, 10).map((f, i) => ({
    name: f.name,
    value: parseFloat(f.amount.toFixed(2)),
    color: COLORS[i % COLORS.length],
  }));

  const splitPieData = data
    ? [
        { name: "Super", value: parseFloat(data.superTotal.toFixed(2)), color: SUPER_COLOR },
        { name: "Shares / ETF", value: parseFloat(data.sharesTotal.toFixed(2)), color: SHARES_COLOR },
      ].filter((d) => d.value > 0)
    : [];

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-card border border-card-border rounded-lg animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 bg-card border border-card-border rounded-lg animate-pulse" />
          <div className="h-72 bg-card border border-card-border rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data || data.transactionCount === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <TrendingUp className="w-12 h-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold">No investment data yet</h2>
        <p className="text-muted-foreground text-sm text-center max-w-sm">
          Import a Frollo CSV and use the Investments tab on Transactions to let the system auto-detect your super contributions, ETFs and shares.
        </p>
        <Link href="/transactions?tab=investments">
          <Button variant="outline" size="sm">Go to Investments tab</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Investment Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.transactionCount} contributions tracked across {data.funds.length} fund{data.funds.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/transactions?tab=investments">
          <Button variant="outline" size="sm" className="flex items-center gap-1.5">
            <ArrowUpRight className="w-3.5 h-3.5" />
            View all transactions
          </Button>
        </Link>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Invested"
          value={formatCurrency(data.totalInvested)}
          sub={`${data.transactionCount} contributions`}
          icon={TrendingUp}
          color="text-purple-400"
        />
        <StatCard
          label="Super Contributions"
          value={formatCurrency(data.superTotal)}
          sub={data.totalInvested > 0 ? `${((data.superTotal / data.totalInvested) * 100).toFixed(0)}% of total` : ""}
          icon={Building2}
          color="text-purple-400"
        />
        <StatCard
          label="Shares / ETFs"
          value={formatCurrency(data.sharesTotal)}
          sub={data.totalInvested > 0 ? `${((data.sharesTotal / data.totalInvested) * 100).toFixed(0)}% of total` : ""}
          icon={Briefcase}
          color="text-blue-400"
        />
        <StatCard
          label="Avg Monthly"
          value={formatCurrency(data.avgMonthly)}
          sub="contribution rate"
          icon={Calendar}
          color="text-emerald-400"
        />
      </div>

      {/* Monthly chart + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly contribution history */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Monthly Contributions</h2>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Last {monthlyChartData.length} months</p>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: SUPER_COLOR }} />Super</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: SHARES_COLOR }} />Shares</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyChartData} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(v: number, name: string) => [formatCurrencyFull(v), name]}
              />
              <Bar dataKey="Super" fill={SUPER_COLOR} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Shares" fill={SHARES_COLOR} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Donut chart — type split */}
        <div className="bg-card border border-card-border rounded-lg p-4 flex flex-col">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">Investment Type</h2>
          {splitPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={splitPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {splitPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {splitPieData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="font-semibold text-foreground">{formatCurrency(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No data</p>
          )}
        </div>
      </div>

      {/* Fund breakdown table */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Fund / Provider Breakdown</h2>
        </div>

        {/* Bar chart of funds */}
        {data.funds.length > 0 && (
          <div className="mb-5">
            <ResponsiveContainer width="100%" height={data.funds.length * 36 + 10}>
              <BarChart
                data={data.funds.map((f) => ({ name: f.name, Amount: f.amount, type: f.type }))}
                layout="vertical"
                barCategoryGap="30%"
                margin={{ left: 0, right: 20, top: 0, bottom: 0 }}
              >
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number) => formatCurrencyFull(v)}
                />
                <Bar dataKey="Amount" radius={[0, 3, 3, 0]}>
                  {data.funds.map((f, i) => (
                    <Cell key={i} fill={f.type === "super" ? SUPER_COLOR : SHARES_COLOR} opacity={0.85 - i * 0.04} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Fund / Provider</th>
                <th className="text-left py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Type</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Contributions</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Count</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Share</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium uppercase tracking-widest">Last</th>
              </tr>
            </thead>
            <tbody>
              {data.funds.map((fund) => (
                <tr key={fund.name} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-foreground">{fund.name}</td>
                  <td className="py-2.5 px-3"><TypeBadge type={fund.type} /></td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-purple-400">{formatCurrencyFull(fund.amount)}</td>
                  <td className="py-2.5 px-3 text-right text-muted-foreground">{fund.count}</td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, fund.percentage)}%`,
                            background: fund.type === "super" ? SUPER_COLOR : SHARES_COLOR,
                          }}
                        />
                      </div>
                      <span className="text-muted-foreground w-8 text-right">{fund.percentage.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-muted-foreground">{fund.lastContribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
