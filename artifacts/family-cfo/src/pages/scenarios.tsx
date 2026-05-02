import { useState } from "react";
import { useSimulateScenario } from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

function DeltaIndicator({ label, current, next }: { label: string; current: number; next: number }) {
  const delta = next - current;
  const isPositive = delta > 0;
  const isNeutral = Math.abs(delta) < 0.1;
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="flex items-end gap-2 mt-1">
        <span className="text-xl font-bold tabular-nums">{typeof next === "number" && next > 900 ? "Surplus" : `${next.toFixed(1)}%`}</span>
        {!isNeutral && (
          <span className={`text-xs font-medium flex items-center gap-0.5 mb-0.5 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? "+" : ""}{delta.toFixed(1)}%
          </span>
        )}
        {isNeutral && <Minus className="w-3 h-3 text-muted-foreground mb-0.5" />}
      </div>
      <p className="text-xs text-muted-foreground mt-1">Was {current.toFixed(1)}%</p>
    </div>
  );
}

export default function Scenarios() {
  const simulate = useSimulateScenario();

  const [scenarioType, setScenarioType] = useState<"income_change" | "new_expense" | "investment" | "debt_payoff" | "holiday">("income_change");
  const [incomeChangePercent, setIncomeChangePercent] = useState(-20);
  const [newMonthlyExpense, setNewMonthlyExpense] = useState(500);
  const [expenseLabel, setExpenseLabel] = useState("Car loan");
  const [investmentAmount, setInvestmentAmount] = useState(25000);
  const [debtAmount, setDebtAmount] = useState(50000);
  const [debtInterestRate, setDebtInterestRate] = useState(5);
  const [holidayBudget, setHolidayBudget] = useState(10000);
  const [projectionMonths, setProjectionMonths] = useState(12);

  const handleSimulate = () => {
    const body: any = { type: scenarioType, projectionMonths };
    if (scenarioType === "income_change") body.incomeChangePercent = incomeChangePercent;
    if (scenarioType === "new_expense") { body.newMonthlyExpense = newMonthlyExpense; body.expenseLabel = expenseLabel; }
    if (scenarioType === "investment") body.investmentAmount = investmentAmount;
    if (scenarioType === "debt_payoff") { body.debtAmount = debtAmount; body.debtInterestRate = debtInterestRate; }
    if (scenarioType === "holiday") body.holidayBudget = holidayBudget;
    simulate.mutate(body);
  };

  const result = simulate.data;

  const chartData = (result?.monthlyProjection ?? []).map((m) => ({
    month: m.month.substring(5),
    Income: m.income,
    Expenses: m.expenses,
    "Savings": m.savings,
    "Cumulative": m.cumulativeSavings,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Scenario Engine</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Simulate financial decisions before you make them</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls */}
        <div className="lg:col-span-1 bg-card border border-card-border rounded-lg p-5 space-y-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Scenario Type</Label>
            <Select value={scenarioType} onValueChange={(v) => setScenarioType(v as any)}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-scenario-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income_change">Income Change</SelectItem>
                <SelectItem value="new_expense">New Monthly Expense</SelectItem>
                <SelectItem value="investment">One-off Investment</SelectItem>
                <SelectItem value="debt_payoff">Debt Repayment</SelectItem>
                <SelectItem value="holiday">Holiday Budget</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scenarioType === "income_change" && (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Income Change: <span className={`font-bold ${incomeChangePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>{incomeChangePercent > 0 ? "+" : ""}{incomeChangePercent}%</span>
              </Label>
              <Slider
                min={-80}
                max={100}
                step={5}
                value={[incomeChangePercent]}
                onValueChange={([v]) => setIncomeChangePercent(v)}
                data-testid="slider-income-change"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>-80%</span>
                <span>0</span>
                <span>+100%</span>
              </div>
            </div>
          )}

          {scenarioType === "new_expense" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Label</Label>
                <Input value={expenseLabel} onChange={(e) => setExpenseLabel(e.target.value)} className="h-8 text-sm" data-testid="input-expense-label" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Monthly Amount (AUD)</Label>
                <Input type="number" value={newMonthlyExpense} onChange={(e) => setNewMonthlyExpense(Number(e.target.value))} className="h-8 text-sm" data-testid="input-monthly-expense" />
              </div>
            </div>
          )}

          {scenarioType === "investment" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Investment Amount (AUD)</Label>
              <Input type="number" value={investmentAmount} onChange={(e) => setInvestmentAmount(Number(e.target.value))} className="h-8 text-sm" data-testid="input-investment-amount" />
            </div>
          )}

          {scenarioType === "debt_payoff" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Debt Amount (AUD)</Label>
                <Input type="number" value={debtAmount} onChange={(e) => setDebtAmount(Number(e.target.value))} className="h-8 text-sm" data-testid="input-debt-amount" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Interest Rate (%)</Label>
                <Input type="number" step="0.1" value={debtInterestRate} onChange={(e) => setDebtInterestRate(Number(e.target.value))} className="h-8 text-sm" data-testid="input-interest-rate" />
              </div>
            </div>
          )}

          {scenarioType === "holiday" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Holiday Budget (AUD)</Label>
              <Input type="number" value={holidayBudget} onChange={(e) => setHolidayBudget(Number(e.target.value))} className="h-8 text-sm" data-testid="input-holiday-budget" />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Projection: <span className="font-bold text-foreground">{projectionMonths} months</span></Label>
            <Slider min={3} max={60} step={3} value={[projectionMonths]} onValueChange={([v]) => setProjectionMonths(v)} data-testid="slider-projection-months" />
          </div>

          <Button
            onClick={handleSimulate}
            disabled={simulate.isPending}
            className="w-full"
            data-testid="button-run-scenario"
          >
            {simulate.isPending ? "Simulating..." : "Run Scenario"}
          </Button>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {!result && !simulate.isPending && (
            <div className="bg-card border border-card-border rounded-lg p-12 flex items-center justify-center">
              <p className="text-muted-foreground text-sm text-center">Configure your scenario and click Run to see the projection</p>
            </div>
          )}

          {simulate.isPending && (
            <div className="bg-card border border-card-border rounded-lg p-12 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">Calculating...</p>
            </div>
          )}

          {result && (
            <>
              {/* Summary Banner */}
              <div className="bg-card border border-card-border rounded-lg p-4">
                <p className="text-sm text-foreground font-medium">{result.summary}</p>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <DeltaIndicator label="Savings Rate" current={result.currentSavingsRate} next={result.newSavingsRate} />
                <div className="bg-card border border-card-border rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Monthly Impact</p>
                  <p className={`text-xl font-bold tabular-nums mt-1 ${result.monthlyCashflowImpact >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {result.monthlyCashflowImpact >= 0 ? "+" : ""}{formatCurrency(result.monthlyCashflowImpact)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">per month</p>
                </div>
                <div className="bg-card border border-card-border rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Cash Runway</p>
                  <p className="text-xl font-bold tabular-nums mt-1">
                    {result.runwayMonthsNew > 900 ? "Sustainable" : `${result.runwayMonthsNew.toFixed(0)} mo`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Was: {result.runwayMonthsCurrent > 900 ? "Surplus" : `${result.runwayMonthsCurrent.toFixed(0)} mo`}</p>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-card border border-card-border rounded-lg p-4">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">Month-by-Month Projection</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                      formatter={(v: number) => formatCurrency(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="Income" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Expenses" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Savings" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="Cumulative" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
