import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Fingerprint, Layers, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

export type CriterionType = "merchant" | "descriptionToken" | "account" | "amount" | "creditDebit";

export interface MatchCriterion {
  type: CriterionType;
  value: string;
}

export interface SourceInfo {
  merchant: string | null;
  description: string;
  descriptionTokens: string[];
  account: string;
  amount: string;
  creditDebit: string;
  transactionType: string | null;
}

export interface SimilarResults {
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

export interface BulkDialogState {
  txId: string;
  oldCategory: string | null;
  newCategory: string;
  source: SourceInfo;
  defaultCriteria: MatchCriterion[];
  results: SimilarResults;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

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

export function BulkApplyDialog({
  state,
  onClose,
  onApply,
}: {
  state: BulkDialogState | null;
  onClose: () => void;
  onApply: (criteria: MatchCriterion[], createRule: boolean) => Promise<void>;
}) {
  const { toast } = useToast();
  const [selectedCriteria, setSelectedCriteria] = useState<MatchCriterion[]>([]);
  const [results, setResults] = useState<SimilarResults | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!state) return;
    setSelectedCriteria(state.defaultCriteria);
    setResults(state.results);
  }, [state]);

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
          body: JSON.stringify({ txId: state.txId, criteria: selectedCriteria }),
        });
        if (res.ok) setResults(await res.json());
      } catch { /* ignore */ }
      finally { setPreviewLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [state, selectedCriteria]);

  if (!state) return null;

  const { source, newCategory, oldCategory } = state;

  const isCriterionSelected = (type: CriterionType, value: string) =>
    selectedCriteria.some((c) => c.type === type && c.value.toLowerCase() === value.toLowerCase());

  const toggleCriterion = (type: CriterionType, value: string) => {
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

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-widest">
            <Fingerprint className="w-3 h-3" />
            Match transactions using
          </div>
          <p className="text-xs text-muted-foreground">
            Select which data points identify these transactions. Toggle on/off to refine — results update live.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {source.merchant && (
              <CriterionChip
                group="Merchant"
                label={source.merchant}
                selected={isCriterionSelected("merchant", source.merchant)}
                onToggle={() => toggleCriterion("merchant", source.merchant!)}
              />
            )}

            {source.descriptionTokens.map((token) => (
              <CriterionChip
                key={token}
                group="Description"
                label={token}
                selected={isCriterionSelected("descriptionToken", token)}
                onToggle={() => toggleCriterion("descriptionToken", token)}
              />
            ))}

            <CriterionChip
              group="Account"
              label={source.account.length > 16 ? source.account.substring(0, 16) + "…" : source.account}
              sublabel={source.account.length > 16 ? source.account : undefined}
              selected={isCriterionSelected("account", source.account)}
              onToggle={() => toggleCriterion("account", source.account)}
            />

            <CriterionChip
              group="Direction"
              label={source.creditDebit === "debit" ? "Debit only" : "Credit only"}
              selected={isCriterionSelected("creditDebit", source.creditDebit)}
              onToggle={() => toggleCriterion("creditDebit", source.creditDebit)}
            />

            <CriterionChip
              group="Amount"
              label={`$${parseFloat(source.amount).toFixed(2)}`}
              selected={isCriterionSelected("amount", source.amount)}
              onToggle={() => toggleCriterion("amount", source.amount)}
            />
          </div>

          <div className="bg-muted/30 rounded px-2.5 py-1.5 text-[11px] text-muted-foreground font-mono truncate" title={source.description}>
            {source.description}
          </div>
        </div>

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
              <div className="space-y-1 max-h-36 overflow-y-auto">
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
                {displayCount > 5 && (
                  <p className="text-xs text-muted-foreground text-center py-1">+ {displayCount - 5} more transactions</p>
                )}
              </div>
            )}
          </div>
        )}

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
