import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Transaction } from "@workspace/api-client-react";

function formatCurrency(amount: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-foreground break-words flex-1">{value}</span>
    </div>
  );
}

interface Props {
  tx: Transaction | null;
  onClose: () => void;
}

export function TransactionDetailDialog({ tx, onClose }: Props) {
  if (!tx) return null;

  const displayDescription = tx.userDescription ?? tx.description;
  const hasCustomDescription = tx.userDescription && tx.userDescription !== tx.description;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-6">{displayDescription}</DialogTitle>
          {tx.merchantName && tx.merchantName !== "Unknown" && (
            <p className="text-sm text-muted-foreground">{tx.merchantName}</p>
          )}
        </DialogHeader>

        <div className="mt-2 space-y-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2">Transaction</div>
          <Row label="Date" value={tx.transactionDate} />
          <Row label="Posted date" value={tx.postedDate} />
          <Row label="Amount" value={
            <span className={tx.creditDebit === "credit" ? "text-emerald-400 font-semibold" : "font-semibold"}>
              {tx.creditDebit === "debit" ? "-" : "+"}{formatCurrency(tx.amount, tx.currency)}
            </span>
          } />
          <Row label="Type" value={tx.transactionType} />
          <Row label="Direction" value={tx.creditDebit} />

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">Account</div>
          <Row label="Account name" value={tx.accountName} />
          <Row label="Account number" value={tx.accountNumber} />
          <Row label="Provider" value={tx.providerName} />

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">Description</div>
          <Row label="Display" value={displayDescription} />
          {hasCustomDescription && <Row label="Original" value={tx.description} />}
          {!hasCustomDescription && tx.description !== displayDescription && <Row label="Raw" value={tx.description} />}

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">Category</div>
          <Row label="Category" value={tx.userCategory ?? tx.categoryName} />
          {tx.userCategory && tx.userCategory !== tx.categoryName && (
            <Row label="Original" value={tx.categoryName} />
          )}
          <Row label="Budget category" value={tx.budgetCategory} />
          {tx.aiConfidenceScore != null && (
            <Row label="AI confidence" value={`${Math.round(tx.aiConfidenceScore * 100)}%`} />
          )}

          {(tx.userTags.length > 0 || tx.notes) && (
            <>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">Notes & Tags</div>
              {tx.userTags.length > 0 && (
                <Row label="Tags" value={
                  <div className="flex flex-wrap gap-1">
                    {tx.userTags.map((tag) => (
                      <span key={tag} className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded text-xs">{tag}</span>
                    ))}
                  </div>
                } />
              )}
              <Row label="Notes" value={tx.notes} />
            </>
          )}

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">Flags</div>
          <Row label="Transfer" value={tx.isTransfer ? "Yes" : "No"} />
          <Row label="Investment" value={tx.isInvestment ? "Yes" : "No"} />
          <Row label="Recurring" value={tx.isRecurring ? "Yes" : "No"} />
          <Row label="Included" value={tx.included ? "Yes" : "No"} />

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mt-4 mb-2">IDs</div>
          <Row label="Transaction ID" value={<span className="font-mono text-[11px]">{tx.transactionId}</span>} />
          <Row label="Internal ID" value={<span className="font-mono text-[11px]">{tx.id}</span>} />
          <Row label="Created" value={new Date(tx.createdAt).toLocaleString("en-AU")} />
          <Row label="Updated" value={new Date(tx.updatedAt).toLocaleString("en-AU")} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
