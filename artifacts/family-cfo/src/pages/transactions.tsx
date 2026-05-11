import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useImportTransactions,
  useUpdateTransaction,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Search, Upload, RefreshCw, Repeat2, Clock, X,
  ChevronLeft, ChevronRight, Shuffle, Tag, Check, ChevronsUpDown,
  AlertTriangle, Layers, Fingerprint, ArrowRight, TrendingUp, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import type { Transaction } from "@workspace/api-client-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

const BASE = import.meta.env.BASE_URL;

// ── Types ─────────────────────────────────────────────────────────────────

export type CriterionType = "merchant" | "descriptionToken" | "account" | "amount" | "creditDebit";

export interface MatchCriterion {
  type: CriterionType;
  value: string;
}

interface SourceInfo {
  merchant: string | null;
  description: string;
  descriptionTokens: string[];
  account: string;
  amount: string;
  creditDebit: string;
  transactionType: string | null;
}

interface SimilarResults {
  count: number;
  totalAmount: number;
  earliestDate: string | null;
  latestDate: string | null;
  categories: string[];
  samples: Array<{
    id: string;
    description: string;
    amount: number;
    creditDebit: string;
    transactionDate: string | null;
    category: string | null;
  }>;
}

interface BulkDialogState {
  txId: string;
  oldCategory: string | null;
  newCategory: string;
  source: SourceInfo;
  defaultCriteria: MatchCriterion[];
  results: SimilarResults;
}

interface TransferTx {
  id: string;
  description: string;
  userDescription?: string | null;
  amount: number;
  creditDebit: string;
  transactionDate: string;
  accountName: string;
  categoryName?: string | null;
  userCategory?: string | null;
  transactionType: string;
}

interface TransferPair {
  id: string;
  amount: number;
  date: string;
  daysApart: number;
  outgoing: TransferTx;
  incoming: TransferTx;
}

interface GroupedTransfers {
  pairs: TransferPair[];
  unpaired: TransferTx[];
  totalPairs: number;
  totalUnpaired: number;
}

// ── Criterion chip ─────────────────────────────────────────────────────────

function CriterionChip({
  label,
  sublabel,
  selected,
  onToggle,
  group,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onToggle: () => void;
  group?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex flex-col items-start px-2.5 py-1.5 rounded-md border text-xs transition-all leading-tight ${
        selected
          ? "bg-primary/15 border-primary/50 text-primary"
          : "bg-muted/40 border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {group && <span className="text-[10px] opacity-60 uppercase tracking-widest mb-0.5">{group}</span>}
      <span className="font-medium">{label}</span>
      {sublabel && <span className="text-[10px] opacity-70 truncate max-w-[120px]">{sublabel}</span>}
    </button>
  );
}

// ── Bulk Apply Dialog ─────────────────────────────────────────────────────

function BulkApplyDialog({
  state,
  onClose,
  onApply,
}: {
  state: BulkDialogState | null;
  onClose: () => void;
  onApply: (criteria: MatchCriterion[], createRule: boolean) => Promise<void>;
}) {
  const [selectedCriteria, setSelectedCriteria] = useState<MatchCriterion[]>([]);
  const [results, setResults] = useState<SimilarResults | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [sampleLimit, setSampleLimit] = useState(5);

  // Initialise when dialog opens
  useEffect(() => {
    if (!state) return;
    setSelectedCriteria(state.defaultCriteria);
    setResults(state.results);
    setSampleLimit(5);
  }, [state]);

  // Re-query when criteria or sampleLimit change (debounced)
  useEffect(() => {
    if (!state || selectedCriteria.length === 0) {
      setResults({ count: 0, totalAmount: 0, earliestDate: null, latestDate: null, categories: [], samples: [] });
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${BASE}api/transactions/preview-similar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txId: state.txId, criteria: selectedCriteria, sampleLimit }),
        });
        if (res.ok) setResults(await res.json());
      } catch { /* ignore */ }
      finally { setPreviewLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [state, selectedCriteria, sampleLimit]);

  if (!state) return null;

  const { source, newCategory, oldCategory } = state;

  const isCriterionSelected = (type: CriterionType, value: string) =>
    selectedCriteria.some((c) => c.type === type && c.value.toLowerCase() === value.toLowerCase());

  const toggleCriterion = (type: CriterionType, value: string) => {
    setSampleLimit(5);
    setSelectedCriteria((prev) => {
      const exists = prev.some((c) => c.type === type && c.value.toLowerCase() === value.toLowerCase());
      if (exists) return prev.filter((c) => !(c.type === type && c.value.toLowerCase() === value.toLowerCase()));
      return [...prev, { type, value }];
    });
  };

  const handleApply = async (createRule: boolean) => {
    if (selectedCriteria.length === 0) return;
    setApplying(true);
    try { await onApply(selectedCriteria, createRule); }
    finally { setApplying(false); }
  };

  const displayCount = results?.count ?? 0;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Apply to similar transactions?
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Changed{oldCategory && <> <span className="text-amber-400">"{oldCategory}"</span> →</>}{" "}
            <span className="text-emerald-400">"{newCategory}"</span>
            {source.merchant && <> for <span className="font-semibold text-foreground">"{source.merchant}"</span></>}.
          </DialogDescription>
        </DialogHeader>

        {/* ── Criteria selector ─────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-widest">
            <Fingerprint className="w-3 h-3" />
            Match transactions using
          </div>
          <p className="text-xs text-muted-foreground">
            Select which data points identify these transactions. Toggle on/off to refine — results update live.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {/* Merchant */}
            {source.merchant && (
              <CriterionChip
                group="Merchant"
                label={source.merchant}
                selected={isCriterionSelected("merchant", source.merchant)}
                onToggle={() => toggleCriterion("merchant", source.merchant!)}
              />
            )}

            {/* Description tokens */}
            {source.descriptionTokens.map((token) => (
              <CriterionChip
                key={token}
                group="Description"
                label={token}
                selected={isCriterionSelected("descriptionToken", token)}
                onToggle={() => toggleCriterion("descriptionToken", token)}
              />
            ))}

            {/* Account */}
            <CriterionChip
              group="Account"
              label={source.account.length > 16 ? source.account.substring(0, 16) + "…" : source.account}
              sublabel={source.account.length > 16 ? source.account : undefined}
              selected={isCriterionSelected("account", source.account)}
              onToggle={() => toggleCriterion("account", source.account)}
            />

            {/* Credit / Debit */}
            <CriterionChip
              group="Direction"
              label={source.creditDebit === "debit" ? "Debit only" : "Credit only"}
              selected={isCriterionSelected("creditDebit", source.creditDebit)}
              onToggle={() => toggleCriterion("creditDebit", source.creditDebit)}
            />

            {/* Exact amount */}
            <CriterionChip
              group="Amount"
              label={`$${parseFloat(source.amount).toFixed(2)}`}
              selected={isCriterionSelected("amount", source.amount)}
              onToggle={() => toggleCriterion("amount", source.amount)}
            />
          </div>

          {/* Raw description for reference */}
          <div className="bg-muted/30 rounded px-2.5 py-1.5 text-[11px] text-muted-foreground font-mono truncate" title={source.description}>
            {source.description}
          </div>
        </div>

        {/* ── Results preview ──────────────────────────────────── */}
        {selectedCriteria.length === 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            Select at least one criterion above to find similar transactions.
          </div>
        ) : (
          <div className="space-y-2">
            <div className={`grid grid-cols-3 gap-2 text-center transition-opacity ${previewLoading ? "opacity-50" : ""}`}>
              <div className="bg-muted rounded-lg p-2.5">
                <p className="text-lg font-bold text-foreground flex items-center justify-center gap-1">
                  {previewLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : displayCount}
                </p>
                <p className="text-xs text-muted-foreground">transactions</p>
              </div>
              <div className="bg-muted rounded-lg p-2.5">
                <p className="text-lg font-bold text-foreground">
                  {previewLoading ? "—" : formatCurrency(results?.totalAmount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">total</p>
              </div>
              <div className="bg-muted rounded-lg p-2.5">
                <p className="text-sm font-bold text-foreground leading-tight">
                  {results?.earliestDate?.substring(0, 7) ?? "—"} →
                </p>
                <p className="text-xs text-muted-foreground">{results?.latestDate?.substring(0, 7) ?? "—"}</p>
              </div>
            </div>

            {(results?.categories ?? []).length > 0 && (
              <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>Currently spread across: <span className="text-foreground">{results!.categories.join(", ")}</span></span>
              </div>
            )}

            {(results?.samples ?? []).length > 0 && (
              <div className={`space-y-1 overflow-y-auto ${sampleLimit > 5 ? "max-h-64" : "max-h-36"}`}>
                {results!.samples.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1 px-2 rounded bg-muted/50 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">{s.description}</p>
                      <p className="text-muted-foreground">{s.transactionDate} · {s.category ?? "—"}</p>
                    </div>
                    <span className={`flex-shrink-0 font-semibold ml-3 ${s.creditDebit === "credit" ? "text-emerald-400" : "text-foreground"}`}>
                      {s.creditDebit === "debit" ? "-" : "+"}{formatCurrency(s.amount)}
                    </span>
                  </div>
                ))}
                {sampleLimit < displayCount && (
                  <button
                    className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors cursor-pointer"
                    onClick={() => setSampleLimit(displayCount)}
                    disabled={previewLoading}
                  >
                    {previewLoading ? "Loading…" : `+ ${displayCount - sampleLimit} more transactions`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-1 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8">
            Keep just this one (already saved)
          </Button>
          <Button
            size="sm"
            onClick={() => handleApply(false)}
            disabled={applying || selectedCriteria.length === 0 || displayCount === 0}
            className="text-xs h-8"
          >
            {applying ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
            Apply "{newCategory}" to all {displayCount} existing transactions
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleApply(true)}
            disabled={applying || selectedCriteria.length === 0 || displayCount === 0}
            className="text-xs h-8 flex items-center gap-1.5"
          >
            <Tag className="w-3 h-3" />
            Apply to existing + create rule for future imports
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Category Picker ───────────────────────────────────────────────────────

function CategoryPicker({
  txId,
  currentCategory,
  allCategories,
  onDone,
}: {
  txId: string;
  currentCategory: string | null;
  allCategories: string[];
  onDone: (newCat: string, oldCat: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateTransaction();
  const { toast } = useToast();

  const handleSelect = (cat: string) => {
    if (cat === currentCategory) { setOpen(false); return; }
    updateMutation.mutate(
      { id: txId, data: { userCategory: cat } },
      {
        onSuccess: () => { setOpen(false); onDone(cat, currentCategory); },
        onError: () => toast({ title: "Failed to update category", variant: "destructive" }),
      }
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="group flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/30 px-2 py-0.5 rounded text-xs transition-colors"
          title="Click to recategorise"
        >
          <span className="truncate max-w-[120px]">{currentCategory ?? "—"}</span>
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
                  disabled={updateMutation.isPending}
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

// ── Main Page ─────────────────────────────────────────────────────────────

export default function Transactions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const search = useSearch();

  const urlParams = new URLSearchParams(search);
  const urlAccount = urlParams.get("account") ?? "";

  const [activeTab, setActiveTab] = useState<"transactions" | "transfers" | "investments">(
    (urlParams.get("tab") as "transactions" | "transfers" | "investments") ?? "transactions"
  );
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState(urlParams.get("category") ?? "All Categories");
  const [accountName, setAccountName] = useState(urlAccount);
  const [creditDebit, setCreditDebit] = useState<"all" | "credit" | "debit">("all");
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialogState | null>(null);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  useEffect(() => {
    fetch(`${BASE}api/transactions/categories`)
      .then((r) => r.json())
      .then((d) => setAllCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (urlAccount) setAccountName(urlAccount);
  }, [urlAccount]);

  const [groupedTransfers, setGroupedTransfers] = useState<GroupedTransfers | null>(null);
  const [groupedLoading, setGroupedLoading] = useState(false);

  const refreshGrouped = useCallback(() => {
    setGroupedLoading(true);
    fetch(`${BASE}api/transfers/grouped`)
      .then((r) => r.json())
      .then((d: GroupedTransfers) => setGroupedTransfers(d))
      .catch(() => {})
      .finally(() => setGroupedLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== "transfers") return;
    refreshGrouped();
  }, [activeTab, refreshGrouped]);

  const limit = 20;
  const params = {
    page, limit,
    search: activeTab === "transactions" ? (debouncedSearch || undefined) : undefined,
    category: activeTab === "transactions" ? (category === "All Categories" ? undefined : category) : undefined,
    accountName: activeTab === "transactions" ? (accountName || undefined) : undefined,
    creditDebit: activeTab === "transactions" ? (creditDebit === "all" ? undefined : creditDebit) : undefined,
    isTransfer: activeTab === "transfers" ? true : undefined,
    isInvestment: activeTab === "investments" ? true : undefined,
  };

  const transactions = useListTransactions(params, { query: { queryKey: getListTransactionsQueryKey(params) } });
  const importMutation = useImportTransactions();
  const updateMutation = useUpdateTransaction();

  const redetectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/transactions/redetect-transfers`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ matched: number; reset: number; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      toast({ title: "Transfer re-detection complete", description: data.message });
    },
    onError: () => toast({ title: "Re-detection failed", variant: "destructive" }),
  });

  const redetectInvestmentsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/transactions/redetect-investments`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ marked: number; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      toast({ title: "Investment re-detection complete", description: data.message });
    },
    onError: () => toast({ title: "Re-detection failed", variant: "destructive" }),
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    clearTimeout((window as any).__searchTimer);
    (window as any).__searchTimer = setTimeout(() => { setDebouncedSearch(e.target.value); setPage(1); }, 400);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const csvContent = evt.target?.result as string;
      importMutation.mutate(
        { data: { csvContent } },
        {
          onSuccess: (result) => {
            toast({ title: "Import complete", description: result.message });
            queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          },
          onError: (err: any) => {
            const msg = err?.data?.error ?? err?.message ?? "Could not parse the CSV file.";
            toast({ title: "Import failed", description: msg, variant: "destructive" });
          },
        }
      );
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const markAsTransfer = (id: string, current: boolean) => {
    updateMutation.mutate(
      { id, data: { isTransfer: !current } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          if (activeTab === "transfers") refreshGrouped();
          toast({ title: "Updated", description: `Marked as ${!current ? "transfer" : "not a transfer"}` });
        },
      }
    );
  };

  const unmarkPair = async (outId: string, inId: string) => {
    try {
      await Promise.all([
        fetch(`${BASE}api/transactions/${outId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isTransfer: false }) }),
        fetch(`${BASE}api/transactions/${inId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isTransfer: false }) }),
      ]);
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      refreshGrouped();
      toast({ title: "Moved to transactions", description: "Both legs reclassified as regular transactions" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const markAsRecurring = (id: string, current: boolean) => {
    updateMutation.mutate(
      { id, data: { isRecurring: !current } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() }); toast({ title: "Updated", description: `Marked as ${!current ? "recurring" : "not recurring"}` }); } }
    );
  };

  // After saving a category change — fetch similar data and open the dialog
  const handleCategoryChanged = useCallback(async (txId: string, newCat: string, oldCat: string | null) => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    try {
      const res = await fetch(`${BASE}api/transactions/${txId}/similar`);
      if (!res.ok) { toast({ title: "Category updated", description: `Recategorised as "${newCat}"` }); return; }
      const data: { source: SourceInfo; defaultCriteria: MatchCriterion[]; results: SimilarResults } = await res.json();
      if (data.results.count > 0) {
        setBulkDialog({ txId, oldCategory: oldCat, newCategory: newCat, source: data.source, defaultCriteria: data.defaultCriteria, results: data.results });
      } else {
        toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
      }
    } catch {
      toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
    }
  }, [queryClient, toast]);

  const handleBulkApply = async (criteria: MatchCriterion[], createRule: boolean) => {
    if (!bulkDialog) return;
    const { txId, newCategory } = bulkDialog;
    const res = await fetch(`${BASE}api/transactions/bulk-recategorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId, criteria, newCategory, createRule }),
    });
    const data = await res.json();
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    toast({
      title: `Updated ${data.updated} transactions`,
      description: createRule
        ? `Recategorised as "${newCategory}" and created a rule for future imports`
        : `Recategorised as "${newCategory}"`,
    });
    setBulkDialog(null);
  };

  const totalPages = transactions.data?.totalPages ?? 1;
  const categoryOptions = ["All Categories", ...allCategories.slice(0, 60)];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {transactions.data ? `${transactions.data.total} ${activeTab === "transfers" ? "transfers" : "transactions"}` : "Loading..."}
            {activeTab === "transactions" && accountName && (
              <> · <span className="text-primary">{accountName}</span>{" "}
                <button onClick={() => setAccountName("")} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3 inline" /></button>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          {activeTab === "transfers" && (
            <Button variant="outline" size="sm" onClick={() => redetectMutation.mutate()} disabled={redetectMutation.isPending} className="flex items-center gap-1.5">
              {redetectMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
              Re-detect transfers
            </Button>
          )}
          {activeTab === "investments" && (
            <Button variant="outline" size="sm" onClick={() => redetectInvestmentsMutation.mutate()} disabled={redetectInvestmentsMutation.isPending} className="flex items-center gap-1.5">
              {redetectInvestmentsMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              Re-detect investments
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending} className="flex items-center gap-1.5">
            {importMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Import CSV
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => { setActiveTab("transactions"); setPage(1); }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "transactions" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Transactions
        </button>
        <button
          onClick={() => { setActiveTab("transfers"); setPage(1); }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${activeTab === "transfers" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <Repeat2 className="w-3.5 h-3.5" />
          Transfers
        </button>
        <button
          onClick={() => { setActiveTab("investments"); setPage(1); }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${activeTab === "investments" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Investments
        </button>
      </div>

      {/* Transfers info banner */}
      {activeTab === "transfers" && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-sm text-blue-300 flex items-start gap-2">
          <Repeat2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Transfer review</p>
            <p className="text-xs text-blue-300/70 mt-0.5">These transactions are excluded from income, expenses and all calculations. Review them here and use <span className="font-medium">Mark as not a transfer</span> if any were incorrectly classified.</p>
          </div>
        </div>
      )}

      {/* Filters — only shown for main transactions tab */}
      {activeTab === "transactions" && (
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={searchText} onChange={handleSearchChange} placeholder="Search transactions..." className="pl-8 h-8 text-sm" />
          </div>
          <div className="relative min-w-[140px]">
            <Input value={accountName} onChange={(e) => { setAccountName(e.target.value); setPage(1); }} placeholder="Filter by account..." className="h-8 text-sm pr-6" />
            {accountName && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setAccountName("")}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={creditDebit} onValueChange={(v) => { setCreditDebit(v as any); setPage(1); }}>
            <SelectTrigger className="h-8 text-sm w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="credit">Credits</SelectItem>
              <SelectItem value="debit">Debits</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── Transactions tab table ── */}
      {activeTab === "transactions" && (
        <>
          <div className="bg-card border border-card-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Date</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Description</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Account</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">
                      Category
                      <span className="ml-1 text-muted-foreground/40 normal-case font-normal">(click to edit)</span>
                    </th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Flags</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Amount</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.isLoading ? (
                    [...Array(8)].map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {[...Array(7)].map((_, j) => (
                          <td key={j} className="py-2.5 px-3"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (transactions.data?.transactions ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        No transactions found. Import a Frollo CSV to get started.
                      </td>
                    </tr>
                  ) : (
                    (transactions.data?.transactions ?? []).map((tx) => (
                      <tr key={tx.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{tx.transactionDate}</td>
                        <td className="py-2.5 px-3 max-w-[200px]">
                          <p className="font-medium text-foreground truncate">{tx.userDescription ?? tx.description}</p>
                          {tx.merchantName && tx.merchantName !== "Unknown" && (
                            <p className="text-muted-foreground text-xs">{tx.merchantName}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                          <button
                            className="truncate max-w-[120px] text-left hover:text-primary transition-colors block"
                            title={`Filter by ${tx.accountName}`}
                            onClick={() => { setAccountName(tx.accountName); setPage(1); }}
                          >
                            {tx.accountName}
                          </button>
                          <p className="text-muted-foreground/60">{tx.providerName}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1">
                            <CategoryPicker
                              txId={tx.id}
                              currentCategory={tx.userCategory ?? tx.categoryName ?? null}
                              allCategories={allCategories}
                              onDone={(newCat, oldCat) => handleCategoryChanged(tx.id, newCat, oldCat)}
                            />
                            {tx.userCategory && tx.userCategory !== tx.categoryName && (
                              <span className="text-xs text-primary" title={`Original: ${tx.categoryName}`}>✎</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex gap-1 flex-wrap">
                            {tx.isRecurring && <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded text-xs">Recurring</span>}
                            <span className="text-xs text-muted-foreground/50">{tx.transactionType}</span>
                          </div>
                        </td>
                        <td className={`py-2.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${tx.creditDebit === "credit" ? "text-emerald-400" : "text-foreground"}`}>
                          {tx.creditDebit === "debit" ? "-" : "+"}{formatCurrency(tx.amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => setDetailTx(tx)}
                              className="text-xs px-2 py-1 rounded border transition-colors border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                              title="View details"
                            >
                              <Info className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => markAsTransfer(tx.id, tx.isTransfer)}
                              className="text-xs px-2 py-1 rounded border transition-colors border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                              title="Mark as transfer"
                            >
                              <Repeat2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => markAsRecurring(tx.id, tx.isRecurring)}
                              className={`text-xs px-2 py-1 rounded border transition-colors ${tx.isRecurring ? "bg-purple-500/20 border-purple-500/30 text-purple-400" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
                              title="Toggle Recurring"
                            >
                              <Clock className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Transfers tab grouped view ── */}
      {activeTab === "transfers" && (
        <>
          {/* Summary bar */}
          {groupedTransfers && (
            <div className="flex items-center gap-5 text-sm text-muted-foreground">
              <span>
                <span className="text-foreground font-medium">{groupedTransfers.totalPairs}</span> matched pairs
              </span>
              {groupedTransfers.totalUnpaired > 0 && (
                <span className="flex items-center gap-1.5 text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="font-medium">{groupedTransfers.totalUnpaired}</span> unpaired
                </span>
              )}
              <button onClick={refreshGrouped} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {groupedLoading && (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {/* Paired transfers */}
          {!groupedLoading && groupedTransfers && groupedTransfers.pairs.length > 0 && (
            <div className="space-y-1.5">
              {groupedTransfers.pairs.map((pair) => (
                <div key={pair.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between gap-4 hover:border-border/80 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{pair.date}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <span className="truncate max-w-[130px] text-muted-foreground" title={pair.outgoing.accountName}>{pair.outgoing.accountName}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                        <span className="truncate max-w-[130px]" title={pair.incoming.accountName}>{pair.incoming.accountName}</span>
                        {pair.daysApart > 0 && (
                          <span className="text-xs text-muted-foreground/50 flex-shrink-0 font-normal">{pair.daysApart}d apart</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/55 truncate mt-0.5">
                        {(pair.outgoing.userDescription ?? pair.outgoing.description).substring(0, 38)} ↔ {(pair.incoming.userDescription ?? pair.incoming.description).substring(0, 38)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(pair.amount)}</span>
                    <button
                      onClick={() => unmarkPair(pair.outgoing.id, pair.incoming.id)}
                      className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap flex items-center gap-1"
                      title="Mark both legs as regular transactions"
                    >
                      <X className="w-3 h-3" /> Not transfers
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unpaired transfers */}
          {!groupedLoading && groupedTransfers && groupedTransfers.unpaired.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 mt-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-medium text-amber-400">
                  {groupedTransfers.totalUnpaired} unpaired — no matching leg found within 3 days
                </h3>
              </div>
              <div className="space-y-1">
                {groupedTransfers.unpaired.map((tx) => (
                  <div key={tx.id} className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{tx.transactionDate}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{tx.userDescription ?? tx.description}</p>
                        <p className="text-xs text-muted-foreground/70 truncate">{tx.accountName} · {tx.transactionType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-sm font-semibold tabular-nums ${tx.creditDebit === "credit" ? "text-emerald-400" : ""}`}>
                        {tx.creditDebit === "debit" ? "-" : "+"}{formatCurrency(tx.amount)}
                      </span>
                      <button
                        onClick={() => markAsTransfer(tx.id, true)}
                        className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap flex items-center gap-1"
                        title="Move back to regular transactions"
                      >
                        <X className="w-3 h-3" /> Not a transfer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!groupedLoading && groupedTransfers && groupedTransfers.totalPairs === 0 && groupedTransfers.totalUnpaired === 0 && (
            <p className="text-center text-muted-foreground py-12 text-sm">No transfers found.</p>
          )}
        </>
      )}

      {/* ── Investments tab ── */}
      {activeTab === "investments" && (
        <>
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3 text-sm text-purple-300 flex items-start gap-2">
            <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Investment tracking</p>
              <p className="text-xs text-purple-300/70 mt-0.5">These are super contributions, ETFs, shares and managed funds — excluded from expenses and shown as their own category. Use <span className="font-medium">Re-detect investments</span> to refresh auto-detection.</p>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Date</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Description</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Account</th>
                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Category</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Amount</th>
                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.isLoading ? (
                    [...Array(8)].map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {[...Array(6)].map((_, j) => (
                          <td key={j} className="py-2.5 px-3"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (transactions.data?.transactions ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-muted-foreground">
                        No investment transactions detected. Import a Frollo CSV or use Re-detect investments.
                      </td>
                    </tr>
                  ) : (
                    (transactions.data?.transactions ?? []).map((tx) => (
                      <tr key={tx.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{tx.transactionDate}</td>
                        <td className="py-2.5 px-3 max-w-[220px]">
                          <p className="font-medium text-foreground truncate">{tx.userDescription ?? tx.description}</p>
                          {tx.merchantName && tx.merchantName !== "Unknown" && (
                            <p className="text-muted-foreground text-xs">{tx.merchantName}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                          <p className="truncate max-w-[120px]">{tx.accountName}</p>
                          <p className="text-muted-foreground/60">{tx.providerName}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded text-xs">
                            <TrendingUp className="w-2.5 h-2.5" />
                            {tx.userCategory ?? tx.categoryName ?? "Investment"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap text-purple-400">
                          -{formatCurrency(tx.amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => updateMutation.mutate(
                              { id: tx.id, data: { isInvestment: false } },
                              {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
                                  toast({ title: "Moved to transactions", description: "Reclassified as a regular transaction" });
                                },
                              }
                            )}
                            className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap flex items-center gap-1 ml-auto"
                            title="Not an investment"
                          >
                            <X className="w-3 h-3" /> Not investment
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {(transactions.data?.totalPages ?? 1) > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Page {page} of {transactions.data?.totalPages ?? 1}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.min(transactions.data?.totalPages ?? 1, p + 1))} disabled={page === (transactions.data?.totalPages ?? 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bulk apply dialog */}
      <BulkApplyDialog
        state={bulkDialog}
        onClose={() => setBulkDialog(null)}
        onApply={handleBulkApply}
      />

      {/* Transaction detail dialog */}
      {detailTx && (
        <TransactionDetailDialog tx={detailTx} onClose={() => setDetailTx(null)} />
      )}
    </div>
  );
}
