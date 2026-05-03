import { useState, useEffect, useCallback } from "react";
import { Building2, CreditCard, ToggleLeft, ToggleRight, AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Account {
  accountName: string;
  accountNumber: string;
  providerName: string;
  totalCount: number;
  includedCount: number;
  skipped: boolean;
}

const PROVIDER_COLORS: Record<string, string> = {
  ANZ: "#007DBA",
  CommBank: "#F5A623",
  "National Australia Bank (NAB)": "#C8102E",
  Westpac: "#DA1710",
  Macquarie: "#3D3D3D",
  ING: "#FF6200",
};

function providerColor(name: string) {
  return PROVIDER_COLORS[name] ?? "#6366f1";
}

function providerInitials(name: string) {
  if (name.startsWith("National Australia")) return "NAB";
  const words = name.split(" ");
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAccounts = useCallback(() => {
    setLoading(true);
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => toast({ title: "Failed to load accounts", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const toggleAccount = async (account: Account) => {
    const newSkipped = !account.skipped;
    setToggling(account.accountNumber);

    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(account.accountNumber)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipped: newSkipped, accountName: account.accountName }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();

      setAccounts((prev) =>
        prev.map((a) =>
          a.accountNumber === account.accountNumber
            ? { ...a, skipped: newSkipped }
            : a
        )
      );

      toast({
        title: newSkipped
          ? `"${account.accountName}" skipped`
          : `"${account.accountName}" included`,
        description: newSkipped
          ? `${data.affected} transactions excluded from all analytics`
          : `${data.affected} transactions restored to analytics`,
      });
    } catch {
      toast({ title: "Failed to update account", variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const activeAccounts = accounts.filter((a) => !a.skipped);
  const skippedAccounts = accounts.filter((a) => a.skipped);
  const totalTransactions = accounts.reduce((s, a) => s + a.totalCount, 0);
  const includedTransactions = accounts.reduce((s, a) => s + (a.skipped ? 0 : a.totalCount), 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which accounts feed into your analytics
          </p>
        </div>
        <button
          onClick={fetchAccounts}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded border border-border hover:border-foreground/30"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      {!loading && accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Accounts</p>
            <p className="text-2xl font-bold text-foreground">{accounts.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeAccounts.length} active, {skippedAccounts.length} skipped</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Included Transactions</p>
            <p className="text-2xl font-bold text-emerald-400">{includedTransactions.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">of {totalTransactions.toLocaleString()} total</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Excluded</p>
            <p className="text-2xl font-bold text-rose-400">{(totalTransactions - includedTransactions).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">from {skippedAccounts.length} skipped account{skippedAccounts.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted rounded w-48" />
                  <div className="h-3 bg-muted rounded w-32" />
                </div>
                <div className="w-14 h-7 bg-muted rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-12 text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No accounts found. Import some transactions first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const isToggling = toggling === account.accountNumber;
            const color = providerColor(account.providerName);
            const initials = providerInitials(account.providerName);

            return (
              <div
                key={account.accountNumber}
                className={`bg-card border rounded-lg p-5 transition-all ${
                  account.skipped
                    ? "border-rose-500/30 opacity-70"
                    : "border-card-border"
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Provider logo placeholder */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                    style={{ background: color }}
                  >
                    {initials}
                  </div>

                  {/* Account info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {account.accountName}
                      </span>
                      {account.skipped && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 flex-shrink-0">
                          Skipped
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <CreditCard className="w-3 h-3" />
                        {account.accountNumber}
                      </span>
                      <span>{account.providerName}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>
                        {account.skipped ? (
                          <span className="text-rose-400">{account.totalCount} transactions excluded</span>
                        ) : (
                          <span className="text-emerald-400">{account.totalCount} transactions included</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => toggleAccount(account)}
                    disabled={isToggling}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex-shrink-0 border ${
                      account.skipped
                        ? "border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                        : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                    } ${isToggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    title={account.skipped ? "Click to include this account" : "Click to skip this account"}
                  >
                    {isToggling ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : account.skipped ? (
                      <ToggleLeft className="w-4 h-4" />
                    ) : (
                      <ToggleRight className="w-4 h-4" />
                    )}
                    {account.skipped ? "Skipped" : "In use"}
                  </button>
                </div>

                {/* Warning when skipped */}
                {account.skipped && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-rose-400/80 bg-rose-500/5 rounded p-2.5 border border-rose-500/10">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      All {account.totalCount} transactions from this account are excluded from your dashboard, cash flow, budget goals, AI advisor, and all other analytics. Click the toggle to restore them.
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
