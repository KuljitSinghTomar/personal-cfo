import { useState, useRef } from "react";
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useImportTransactions,
  useUpdateTransaction,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Search, Upload, RefreshCw, Repeat2, Clock, X, ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(amount);
}

const CATEGORIES = [
  "All Categories",
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Entertainment",
  "Health",
  "Shopping",
  "General Merchandise",
  "Credit Card Payments",
  "Transfer Between Accounts",
  "Salary/Regular Income",
  "Interest Income",
];

export default function Transactions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [creditDebit, setCreditDebit] = useState<"all" | "credit" | "debit">("all");
  const [showTransfers, setShowTransfers] = useState<boolean | undefined>(undefined);

  const limit = 20;

  const params = {
    page,
    limit,
    search: debouncedSearch || undefined,
    category: category === "All Categories" ? undefined : category,
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
      const res = await fetch(`${import.meta.env.BASE_URL}api/transactions/redetect-transfers`, { method: "POST" });
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
    setSearch(e.target.value);
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
            toast({
              title: "Import complete",
              description: result.message,
            });
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

  const totalPages = transactions.data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {transactions.data ? `${transactions.data.total} transactions` : "Loading..."}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="file-input-csv"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => redetectMutation.mutate()}
            disabled={redetectMutation.isPending}
            title="Re-run pair-matching: a transfer is only flagged when both sides (debit + matching credit) exist in the database"
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
            data-testid="button-import-csv"
            className="flex items-center gap-1.5"
          >
            {importMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Import CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search transactions..."
            className="pl-8 h-8 text-sm"
            data-testid="input-search-transactions"
          />
        </div>

        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="h-8 text-sm w-44" data-testid="select-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={creditDebit} onValueChange={(v) => { setCreditDebit(v as any); setPage(1); }}>
          <SelectTrigger className="h-8 text-sm w-28" data-testid="select-credit-debit">
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
          data-testid="button-filter-transfers"
        >
          Hide transfers
        </Button>

        <Button
          variant={showTransfers === true ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowTransfers(showTransfers === true ? undefined : true)}
          data-testid="button-show-transfers"
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
                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-widest">Category</th>
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
                  <tr key={tx.id} className={`border-b border-border hover:bg-muted/30 transition-colors ${tx.isTransfer ? "opacity-60" : ""}`} data-testid={`row-transaction-${tx.id}`}>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{tx.transactionDate}</td>
                    <td className="py-2.5 px-3 max-w-[200px]">
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
                      <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs">
                        {tx.userCategory ?? tx.categoryName ?? "—"}
                      </span>
                      {tx.aiConfidenceScore !== null && tx.aiConfidenceScore !== undefined && (
                        <span className="ml-1 text-xs text-muted-foreground">{(tx.aiConfidenceScore * 100).toFixed(0)}%</span>
                      )}
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
                          data-testid={`button-toggle-transfer-${tx.id}`}
                        >
                          <Repeat2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => markAsRecurring(tx.id, tx.isRecurring)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${tx.isRecurring ? "bg-purple-500/20 border-purple-500/30 text-purple-400" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
                          title="Toggle Recurring"
                          data-testid={`button-toggle-recurring-${tx.id}`}
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
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-7 w-7 p-0"
                data-testid="button-next-page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
