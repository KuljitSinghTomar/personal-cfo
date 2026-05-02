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
  AlertTriangle, Layers,
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

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

const BASE = import.meta.env.BASE_URL;

// ── Types ─────────────────────────────────────────────────────────────────

interface SimilarResult {
  count: number;
  totalAmount: number;
  earliestDate: string;
  latestDate: string;
  matchedOn: "merchant" | "description";
  matchValue: string;
  categories: string[];
  samples: Array<{
    id: string;
    description: string;
    amount: number;
    creditDebit: string;
    transactionDate: string;
    category: string | null;
  }>;
}

interface BulkDialogState {
  txId: string;
  oldCategory: string | null;
  newCategory: string;
  similar: SimilarResult;
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
        onSuccess: () => {
          setOpen(false);
          onDone(cat, currentCategory);
        },
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

// ── Bulk Apply Dialog ─────────────────────────────────────────────────────

function BulkApplyDialog({
  state,
  onClose,
  onApply,
}: {
  state: BulkDialogState | null;
  onClose: () => void;
  onApply: (createRule: boolean) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  if (!state) return null;

  const { similar, oldCategory, newCategory } = state;

  const handleApply = async (createRule: boolean) => {
    setLoading(true);
    try { await onApply(createRule); } finally { setLoading(false); }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Apply to similar transactions?
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            You changed{" "}
            <span className="font-semibold text-foreground">"{similar.matchValue}"</span>
            {oldCategory && <> from <span className="text-amber-400">"{oldCategory}"</span></>}
            {" "}to <span className="text-emerald-400">"{newCategory}"</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted rounded-lg p-2.5">
            <p className="text-lg font-bold text-foreground">{similar.count}</p>
            <p className="text-xs text-muted-foreground">transactions</p>
          </div>
          <div className="bg-muted rounded-lg p-2.5">
            <p className="text-lg font-bold text-foreground">{formatCurrency(similar.totalAmount)}</p>
            <p className="text-xs text-muted-foreground">total</p>
          </div>
          <div className="bg-muted rounded-lg p-2.5">
            <p className="text-sm font-bold text-foreground leading-tight">{similar.earliestDate?.substring(0, 7)} →</p>
            <p className="text-xs text-muted-foreground">{similar.latestDate?.substring(0, 7)}</p>
          </div>
        </div>

        {/* Current categories breakdown */}
        {similar.categories.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
            <span>Currently spread across: <span className="text-foreground">{similar.categories.join(", ")}</span></span>
          </div>
        )}

        {/* Sample transactions */}
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {similar.samples.map((s) => (
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
          {similar.count > 5 && (
            <p className="text-xs text-muted-foreground text-center py-1">
              + {similar.count - 5} more transactions
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8">
            Keep just this one (already saved)
          </Button>
          <Button
            size="sm"
            onClick={() => handleApply(false)}
            disabled={loading}
            className="text-xs h-8"
          >
            {loading ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
            Apply "{newCategory}" to all {similar.count} existing transactions
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleApply(true)}
            disabled={loading}
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

// ── Main Page ─────────────────────────────────────────────────────────────

export default function Transactions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const search = useSearch();

  // Read account filter from URL ?account=NAME
  const urlParams = new URLSearchParams(search);
  const urlAccount = urlParams.get("account") ?? "";

  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [accountName, setAccountName] = useState(urlAccount);
  const [creditDebit, setCreditDebit] = useState<"all" | "credit" | "debit">("all");
  const [showTransfers, setShowTransfers] = useState<boolean | undefined>(undefined);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialogState | null>(null);

  // Load all distinct categories for the picker
  useEffect(() => {
    fetch(`${BASE}api/transactions/categories`)
      .then((r) => r.json())
      .then((d) => setAllCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  // Apply URL account param on mount
  useEffect(() => {
    if (urlAccount) setAccountName(urlAccount);
  }, [urlAccount]);

  const limit = 20;

  const params = {
    page,
    limit,
    search: debouncedSearch || undefined,
    category: category === "All Categories" ? undefined : category,
    accountName: accountName || undefined,
    creditDebit: creditDebit === "all" ? undefined : creditDebit,
    isTransfer: showTransfers,
  };

  const transactions = useListTransactions(params, {
    query: { queryKey: getListTransactionsQueryKey(params) },
  });

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    clearTimeout((window as any).__searchTimer);
    (window as any).__searchTimer = setTimeout(() => {
      setDebouncedSearch(e.target.value);
      setPage(1);
    }, 400);
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
          toast({ title: "Updated", description: `Marked as ${!current ? "transfer" : "not a transfer"}` });
        },
      }
    );
  };

  const markAsRecurring = (id: string, current: boolean) => {
    updateMutation.mutate(
      { id, data: { isRecurring: !current } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          toast({ title: "Updated", description: `Marked as ${!current ? "recurring" : "not recurring"}` });
        },
      }
    );
  };

  // Called after a category is changed — checks for similar and opens dialog
  const handleCategoryChanged = useCallback(async (txId: string, newCat: string, oldCat: string | null) => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    try {
      const res = await fetch(`${BASE}api/transactions/${txId}/similar`);
      if (!res.ok) return;
      const similar: SimilarResult = await res.json();
      if (similar.count > 0) {
        setBulkDialog({ txId, oldCategory: oldCat, newCategory: newCat, similar });
      } else {
        toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
      }
    } catch {
      toast({ title: "Category updated", description: `Recategorised as "${newCat}"` });
    }
  }, [queryClient, toast]);

  const handleBulkApply = async (createRule: boolean) => {
    if (!bulkDialog) return;
    const { similar, newCategory } = bulkDialog;
    try {
      const res = await fetch(`${BASE}api/transactions/bulk-recategorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchField: similar.matchedOn,
          matchValue: similar.matchValue,
          newCategory,
          createRule,
        }),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      toast({
        title: `Updated ${data.updated} transactions`,
        description: createRule
          ? `Recategorised as "${newCategory}" and created a rule for future imports`
          : `Recategorised as "${newCategory}"`,
      });
    } catch {
      toast({ title: "Failed to bulk apply", variant: "destructive" });
    }
    setBulkDialog(null);
  };

  const totalPages = transactions.data?.totalPages ?? 1;

  const categoryOptions = ["All Categories", ...allCategories.slice(0, 40)];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {transactions.data ? `${transactions.data.total} transactions` : "Loading..."}
            {accountName && <> · <span className="text-primary">{accountName}</span> <button onClick={() => setAccountName("")} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3 inline" /></button></>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => redetectMutation.mutate()}
            disabled={redetectMutation.isPending}
            title="Re-run pair-matching transfer detection"
            className="flex items-center gap-1.5"
          >
            {redetectMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
            Re-detect transfers
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="flex items-center gap-1.5"
          >
            {importMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Import CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={handleSearchChange}
            placeholder="Search transactions..."
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Account filter */}
        <div className="relative min-w-[140px]">
          <Input
            value={accountName}
            onChange={(e) => { setAccountName(e.target.value); setPage(1); }}
            placeholder="Filter by account..."
            className="h-8 text-sm pr-6"
          />
          {accountName && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setAccountName("")}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="h-8 text-sm w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={creditDebit} onValueChange={(v) => { setCreditDebit(v as any); setPage(1); }}>
          <SelectTrigger className="h-8 text-sm w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="credit">Credits</SelectItem>
            <SelectItem value="debit">Debits</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={showTransfers === false ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowTransfers(showTransfers === false ? undefined : false)}
        >
          Hide transfers
        </Button>

        <Button
          variant={showTransfers === true ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowTransfers(showTransfers === true ? undefined : true)}
        >
          Transfers only
        </Button>
      </div>

      {/* Table */}
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
                      <td key={j} className="py-2.5 px-3">
                        <div className="h-3 bg-muted rounded animate-pulse" />
                      </td>
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
                  <tr
                    key={tx.id}
                    className={`border-b border-border hover:bg-muted/30 transition-colors ${tx.isTransfer ? "opacity-60" : ""}`}
                  >
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
                        {tx.aiConfidenceScore !== null && tx.aiConfidenceScore !== undefined && !tx.userCategory && (
                          <span className="text-xs text-muted-foreground">{(tx.aiConfidenceScore * 100).toFixed(0)}%</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {tx.isTransfer && (
                          <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded text-xs">Transfer</span>
                        )}
                        {tx.isRecurring && (
                          <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded text-xs">Recurring</span>
                        )}
                      </div>
                    </td>
                    <td className={`py-2.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${tx.creditDebit === "credit" ? "text-emerald-400" : "text-foreground"}`}>
                      {tx.creditDebit === "debit" ? "-" : "+"}{formatCurrency(tx.amount)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => markAsTransfer(tx.id, tx.isTransfer)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${tx.isTransfer ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
                          title="Toggle Transfer"
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({transactions.data?.total ?? 0} total)
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Apply Dialog */}
      <BulkApplyDialog
        state={bulkDialog}
        onClose={() => setBulkDialog(null)}
        onApply={handleBulkApply}
      />
    </div>
  );
}
