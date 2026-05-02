import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listNetWorthAccounts,
  createNetWorthAccount,
  updateNetWorthAccount,
  deleteNetWorthAccount,
  syncNetWorthAccounts,
  takeNetWorthSnapshot,
  getNetWorthHistory,
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Home,
  Car,
  Briefcase,
  CreditCard,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  Link,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = {
  asset: [
    { value: "bank_account", label: "Bank Account", icon: Building2 },
    { value: "savings", label: "Savings / Offset", icon: PiggyBank },
    { value: "super", label: "Superannuation", icon: Briefcase },
    { value: "property", label: "Property", icon: Home },
    { value: "shares", label: "Shares / ETFs", icon: TrendingUp },
    { value: "vehicle", label: "Vehicle", icon: Car },
    { value: "other_asset", label: "Other Asset", icon: TrendingUp },
  ],
  liability: [
    { value: "home_loan", label: "Home Loan / Mortgage", icon: Home },
    { value: "credit_card", label: "Credit Card", icon: CreditCard },
    { value: "car_loan", label: "Car Loan", icon: Car },
    { value: "personal_loan", label: "Personal Loan", icon: TrendingDown },
    { value: "other_liability", label: "Other Liability", icon: TrendingDown },
  ],
};

function categoryMeta(category: string) {
  const all = [...CATEGORIES.asset, ...CATEGORIES.liability];
  return all.find((c) => c.value === category) ?? { label: category, icon: Building2 };
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtChange(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmt(n)}`;
}

type Account = {
  id: string; name: string; institution: string | null; type: "asset" | "liability";
  category: string; currentBalance: number; baseBalance: number;
  balanceSource: "derived" | "manual"; linkedAccountNumber: string | null;
  linkedAccountName: string | null; isLinked: boolean; notes: string | null;
  sortOrder: number; createdAt: string; updatedAt: string;
};

type EditForm = { name: string; institution: string; currentBalance: string; baseBalance: string; notes: string; };
type AddForm = { name: string; institution: string; type: "asset" | "liability"; category: string; currentBalance: string; baseBalance: string; notes: string; };

export default function NetWorth() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", institution: "", currentBalance: "", baseBalance: "", notes: "" });
  const [addForm, setAddForm] = useState<AddForm>({ name: "", institution: "", type: "asset", category: "bank_account", currentBalance: "0", baseBalance: "0", notes: "" });

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ["net-worth-accounts"],
    queryFn: () => listNetWorthAccounts(),
  });

  const { data: historyData } = useQuery({
    queryKey: ["net-worth-history"],
    queryFn: () => getNetWorthHistory(),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncNetWorthAccounts(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["net-worth-accounts"] });
      qc.invalidateQueries({ queryKey: ["net-worth-history"] });
      toast({ title: "Synced", description: data.message });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createNetWorthAccount>[0]["data"]) =>
      createNetWorthAccount({ data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["net-worth-accounts"] });
      setShowAdd(false);
      setAddForm({ name: "", institution: "", type: "asset", category: "bank_account", currentBalance: "0", baseBalance: "0", notes: "" });
      toast({ title: "Account added" });
    },
    onError: () => toast({ title: "Failed to add account", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateNetWorthAccount>[1]["data"] }) =>
      updateNetWorthAccount(id, { data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["net-worth-accounts"] });
      setEditingId(null);
      toast({ title: "Account updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetWorthAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["net-worth-accounts"] });
      toast({ title: "Account removed" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const snapshotMutation = useMutation({
    mutationFn: () => takeNetWorthSnapshot(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["net-worth-history"] });
      toast({ title: "Snapshot saved" });
    },
  });

  const accounts: Account[] = (accountsData?.accounts ?? []) as Account[];
  const totalAssets = accountsData?.totalAssets ?? 0;
  const totalLiabilities = accountsData?.totalLiabilities ?? 0;
  const netWorth = accountsData?.netWorth ?? 0;

  const assets = accounts.filter((a) => a.type === "asset");
  const liabilities = accounts.filter((a) => a.type === "liability");

  const snapshots = historyData?.snapshots ?? [];
  const chartData = snapshots.map((s) => ({
    date: s.snapshotDate,
    "Net Worth": Math.round(s.netWorth),
    Assets: Math.round(s.totalAssets),
    Liabilities: Math.round(s.totalLiabilities),
  }));

  const prevSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const monthlyChange = prevSnapshot ? netWorth - prevSnapshot.netWorth : null;

  function startEdit(acc: Account) {
    setEditingId(acc.id);
    setEditForm({
      name: acc.name,
      institution: acc.institution ?? "",
      currentBalance: String(acc.currentBalance),
      baseBalance: String(acc.baseBalance),
      notes: acc.notes ?? "",
    });
  }

  function saveEdit(acc: Account) {
    updateMutation.mutate({
      id: acc.id,
      data: {
        name: editForm.name || undefined,
        institution: editForm.institution || undefined,
        currentBalance: acc.balanceSource === "manual" ? parseFloat(editForm.currentBalance) : undefined,
        baseBalance: acc.balanceSource === "derived" ? parseFloat(editForm.baseBalance) : undefined,
        notes: editForm.notes || undefined,
      },
    });
  }

  function submitAdd() {
    createMutation.mutate({
      name: addForm.name,
      institution: addForm.institution || undefined,
      type: addForm.type,
      category: addForm.category,
      currentBalance: parseFloat(addForm.currentBalance) || 0,
      balanceSource: "manual",
      notes: addForm.notes || undefined,
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Net Worth</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track your assets, liabilities and wealth over time
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", syncMutation.isPending && "animate-spin")} />
            Sync accounts
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => snapshotMutation.mutate()}
            disabled={snapshotMutation.isPending}
          >
            Save snapshot
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add account
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Net Worth</p>
          <p className={cn("text-2xl font-bold mt-1", netWorth >= 0 ? "text-emerald-400" : "text-red-400")}>
            {fmt(netWorth)}
          </p>
          {monthlyChange !== null && (
            <p className={cn("text-xs mt-1", monthlyChange >= 0 ? "text-emerald-400" : "text-red-400")}>
              {fmtChange(monthlyChange)} since last snapshot
            </p>
          )}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Assets</p>
          <p className="text-xl font-bold mt-1 text-emerald-400">{fmt(totalAssets)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Liabilities</p>
          <p className="text-xl font-bold mt-1 text-red-400">{fmt(totalLiabilities)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Debt-to-Assets</p>
          <p className="text-xl font-bold mt-1">
            {totalAssets > 0 ? `${Math.round((totalLiabilities / totalAssets) * 100)}%` : "—"}
          </p>
        </div>
      </div>

      {/* Chart */}
      {chartData.length >= 2 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-4">Net Worth History</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#888" }} tickLine={false} />
              <YAxis
                tickFormatter={(v) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                tick={{ fontSize: 11, fill: "#888" }}
                tickLine={false}
                axisLine={false}
                width={70}
              />
              <Tooltip
                formatter={(v: number) => [fmt(v), ""]}
                contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                labelStyle={{ color: "#888", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="Net Worth" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Assets" stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="Liabilities" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Assets */}
      <AccountSection
        title="Assets"
        accounts={assets}
        editingId={editingId}
        editForm={editForm}
        setEditForm={setEditForm}
        onEdit={startEdit}
        onSave={saveEdit}
        onCancel={() => setEditingId(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        accentColor="text-emerald-400"
      />

      {/* Liabilities */}
      <AccountSection
        title="Liabilities"
        accounts={liabilities}
        editingId={editingId}
        editForm={editForm}
        setEditForm={setEditForm}
        onEdit={startEdit}
        onSave={saveEdit}
        onCancel={() => setEditingId(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        accentColor="text-red-400"
      />

      {/* Empty state */}
      {!isLoading && accounts.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <TrendingUp className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold">No accounts yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Import transactions to auto-detect your bank accounts, or add assets manually.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => syncMutation.mutate()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync from transactions
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add manually
            </Button>
          </div>
        </div>
      )}

      {/* Add Account Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-card border border-border max-w-md">
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={addForm.type} onValueChange={(v) => setAddForm((f) => ({ ...f, type: v as "asset" | "liability", category: v === "asset" ? "bank_account" : "home_loan" }))}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={addForm.category} onValueChange={(v) => setAddForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES[addForm.type].map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input className="h-8 text-sm" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. ANZ Savings" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Institution (optional)</Label>
              <Input className="h-8 text-sm" value={addForm.institution} onChange={(e) => setAddForm((f) => ({ ...f, institution: e.target.value }))} placeholder="e.g. ANZ" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Current Balance (AUD)</Label>
              <Input className="h-8 text-sm" type="number" value={addForm.currentBalance} onChange={(e) => setAddForm((f) => ({ ...f, currentBalance: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input className="h-8 text-sm" value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={!addForm.name || createMutation.isPending}>Add account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountSection({
  title, accounts, editingId, editForm, setEditForm, onEdit, onSave, onCancel, onDelete, accentColor,
}: {
  title: string;
  accounts: Account[];
  editingId: string | null;
  editForm: EditForm;
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>;
  onEdit: (acc: Account) => void;
  onSave: (acc: Account) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  accentColor: string;
}) {
  if (accounts.length === 0) return null;

  const total = accounts.reduce((s, a) => s + a.currentBalance, 0);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">{title}</h2>
        <span className={cn("font-bold text-sm", accentColor)}>{fmt(total)}</span>
      </div>
      <div className="divide-y divide-border">
        {accounts.map((acc) => {
          const meta = categoryMeta(acc.category);
          const Icon = meta.icon;
          const isEditing = editingId === acc.id;
          return (
            <div key={acc.id} className="px-4 py-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input className="h-7 text-xs" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Institution</Label>
                      <Input className="h-7 text-xs" value={editForm.institution} onChange={(e) => setEditForm((f) => ({ ...f, institution: e.target.value }))} />
                    </div>
                  </div>
                  {acc.balanceSource === "manual" ? (
                    <div className="space-y-1">
                      <Label className="text-xs">Balance (AUD)</Label>
                      <Input className="h-7 text-xs" type="number" value={editForm.currentBalance} onChange={(e) => setEditForm((f) => ({ ...f, currentBalance: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs">Starting balance (AUD) — derived balance = starting + transaction net flow</Label>
                      <Input className="h-7 text-xs" type="number" value={editForm.baseBalance} onChange={(e) => setEditForm((f) => ({ ...f, baseBalance: e.target.value }))} />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Input className="h-7 text-xs" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={() => onSave(acc)}>Save</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{acc.name}</span>
                        {acc.isLinked && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                            <Link className="h-2.5 w-2.5" />
                            Linked
                          </span>
                        )}
                        {acc.balanceSource === "derived" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                            Auto
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{acc.institution ?? meta.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={cn("text-sm font-semibold", accentColor)}>{fmt(acc.currentBalance)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(acc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(acc.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
