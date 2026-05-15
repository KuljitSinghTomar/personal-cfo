# Family CFO — Technical Specification

## 1. High-Level Overview

**Family CFO** is a single-tenant personal finance command centre, designed around the workflow of an Australian household importing bank transactions via Frollo CSV exports. It is built as a monorepo with three tiers:

- **Frontend** — A React + Vite single-page application (`artifacts/family-cfo`) using TanStack Query for server state, Wouter for routing, Recharts for charts, and a shadcn/ui-based component library on a dark, information-dense theme.
- **Backend** — An Express API server (`artifacts/api-server`) exposing JSON endpoints under `/api`. It is stateless aside from the database; there is **no authentication** (the product is a personal/family tool).
- **Database** — PostgreSQL accessed through Drizzle ORM (`lib/db`), with seven tables: `transactions`, `budget_goals`, `net_worth_accounts`, `net_worth_snapshots`, `category_rules`, `account_preferences`, and chat scaffolding (`conversations`, `messages`).

The system is organised around a single canonical fact table — `transactions` — populated by CSV imports and decorated with a series of boolean flags (`isTransfer`, `isInvestment`, `isRecurring`, `included`) and user-overridable annotations (`userCategory`, `userDescription`, `userTags`, `notes`). Every downstream analytical view (dashboard KPIs, cashflow chart, budget status, AI insights, scenarios, net worth) is recomputed on demand from this table; nothing is materialised. Money flows are classified through a layered detection pipeline executed at import time and re-runnable on demand:

1. **Category rules** (user-authored OR/AND patterns) are applied during import to set `userCategory`.
2. **Transfer detection** runs in three sweeps: clear all flags, flag loan/mortgage credits, flag any category that mentions "transfer" or "credit card payment", then match orphan debit/credit pairs by amount within three days across different accounts.
3. **Investment detection** marks debits whose category or description match a curated list of Australian super/share platforms.
4. **Net worth sync** turns each distinct `accountNumber` in transactions into a linked net-worth account, with `currentBalance = baseBalance + (credits − debits)`.

The dashboard surfaces aggregated metrics (income, expenses, invested, net cashflow, savings rate) and a cashflow chart that separates explicit "mortgage-goal offset" savings (credits to an asset-typed savings account whose `linkedAccountNumber` matches the transaction's account) from the residual "free cash". A side panel of rule-generated AI insights and a Claude-powered streaming chat (`claude-sonnet-4-6`) inject real numbers as system-prompt context to provide household-specific advice. Budget goals are auto-generated from the trailing twelve months of category spend (10% buffer, rounded up to $10), but goals the user edits are locked and never overwritten by subsequent auto-runs. The scenario engine projects monthly cashflow forward using historical averages adjusted by one of five parameterised levers (income change, new expense, investment, debt payoff, holiday).

Currency is treated as AUD throughout; numeric values are persisted as `NUMERIC(12,2)` strings and reconstituted via `parseFloat` at the API boundary. Dates on transactions are stored as `text` in `YYYY-MM-DD` form to side-step timezone drift and to enable month-key extraction via `substring(0, 7)`.

---

## 2. Data Model

### 2.1 `transactions`
The primary fact table. Each row represents one bank-emitted line. Defined at [lib/db/src/schema/transactions.ts](lib/db/src/schema/transactions.ts).

| Column | Purpose |
| --- | --- |
| `id` | App-generated UUID primary key. |
| `transactionId` | Unique constraint — matches the Frollo CSV's `transaction_id`, used for upsert. |
| `description`, `amount`, `currency`, `transactionDate`, `postedDate`, `accountNumber`, `accountName`, `creditDebit`, `transactionType`, `providerName`, `merchantName`, `categoryName` | **Bank-provided fields**: overwritten on re-import if Frollo changes them. |
| `userDescription`, `userCategory`, `userTags`, `notes`, `budgetCategory` | **App-managed fields**: preserved across re-imports. |
| `isTransfer` | True when the row is one leg of an internal transfer; excluded from income/expense maths. |
| `isInvestment` | True when the debit is a super contribution or share/ETF purchase; bucketed separately. |
| `isRecurring` | User-driven flag; informational. |
| `aiConfidenceScore` | Stored but not currently consumed by analytics. |
| `included` | Master toggle. When false (set via the Accounts page), the row is removed from every analytical query. |
| `amount` | Always stored as a positive number; direction is encoded in `creditDebit` ∈ {`credit`, `debit`}. |

### 2.2 `budget_goals`
One row per category. `source` is `auto` (created by the generator) or `manual` (created via the Add Goal form). `userEdited=true` locks a goal against auto-overwrite. `avgMonthlySpend` is the 12-month rolling average snapshotted at last auto-generate.

### 2.3 `net_worth_accounts`
Either **linked** (auto-derived from transactions) or **manual** (user-entered for assets/liabilities not present in CSV — property, super, shares).
- `type` ∈ {`asset`, `liability`}
- `category` ∈ {`bank_account`, `savings`, `super`, `property`, `shares`, `vehicle`, `home_loan`, `credit_card`, `car_loan`, `personal_loan`, `other_asset`, `other_liability`}
- `baseBalance` — the manual starting point. For linked accounts, the derived `currentBalance = baseBalance + Σcredits − Σdebits` over the entire transaction history.
- `linkedAccountNumber` — joins to `transactions.account_number`.

### 2.4 `net_worth_snapshots`
A daily upsert keyed on `snapshot_date` (`YYYY-MM-DD`). Stores totals plus a `breakdown` JSON blob of per-account balances. Used to draw the trend chart and to compute the "monthly change" delta on the net worth summary.

### 2.5 `category_rules`
User-authored mapping rules. Each rule has a `matchPattern`, a `matchField` ∈ {`merchant`, `description`, `category`}, a target `category`, and an `isActive` flag. Pattern syntax: pipes (`|`) are OR alternatives, ampersands (`&`) are AND terms within an alternative. The matcher lower-cases both sides and uses substring containment.

### 2.6 `account_preferences`
Keyed by `account_number`. The only field that matters is `skipped`. Toggling it via the Accounts page bulk-sets `included` on every transaction with that account number.

### 2.7 `conversations` / `messages`
Scaffolding for persistent chat history. Not currently wired into the AI chat flow, which is purely request/response with client-supplied history.

---

## 3. CSV Import Pipeline

Entry point: `POST /api/transactions/import` in [artifacts/api-server/src/routes/transactions.ts:421](artifacts/api-server/src/routes/transactions.ts#L421). The body is a JSON object `{ csvContent: string }`. The CSV is parsed with `csv-parse/sync` into an array of records keyed by header name.

### 3.1 Per-row processing

For each row, the importer:

1. **Validates** the row has a `transaction_id`. Missing IDs are counted as errors and skipped.
2. **Normalises** the amount with `Math.abs(parseFloat(...)).toFixed(2)`; direction comes from the `credit_debit` column.
3. **Reads** the `included` column (defaults to `true` if the value is anything other than the literal string `"false"`).
4. **Splits** the comma-separated `user_tags` field into a string array.
5. **Computes** `isTransferCategory`: `true` if the CSV's `category_name` (lower-cased) contains `"transfer"` or `"credit card payment"`.
6. **Computes** `csvIsInvestment`: `true` if the row is a debit AND the category/description matches the investment patterns in §6.
7. **Looks up** an existing row by `transaction_id`.

### 3.2 Active category rules
Before iterating rows, the importer loads every active rule once. The helper `applyRules(merchant, description, categoryName)` returns the first rule's target category whose `matchField`-derived text matches the rule's pattern. Pattern matching is the OR-of-AND substring test described in §2.5.

### 3.3 Insert vs update logic

**New row** ([line 558](artifacts/api-server/src/routes/transactions.ts#L558)): a fresh UUID is allocated; the row is inserted with both `categoryName` and `userCategory` set to the rule's match (if any) — meaning the bank's raw category is **never stored** on first import when a rule matched. `isTransfer` is seeded from `isTransferCategory`, `isInvestment` from `csvIsInvestment`, `isRecurring=false`. `aiConfidenceScore` is hard-coded to `"0.85"`.

**Existing row** ([line 510](artifacts/api-server/src/routes/transactions.ts#L510)): the importer first computes `effectiveCategoryName = ruleCategory ?? categoryName` so that the comparison uses what would actually be stored (this avoids spurious "changed" detections on rows whose bank category was rewritten by a rule on a previous import — a fix specifically targeting mortgage repayment categorisation). It then compares all twelve bank-provided fields against the existing row:

- If **no** bank field has changed → `skipped++`, no write.
- If **any** has changed → all bank fields are overwritten **but every app-managed field is preserved** (`userCategory`, `userDescription`, `userTags`, `notes`, `included`, `budgetCategory`, `isTransfer`, `isInvestment`, `isRecurring`, `aiConfidenceScore`). The only exception is that if `userCategory` was previously NULL and a rule now matches, the rule's category is written into `userCategory` ([line 540](artifacts/api-server/src/routes/transactions.ts#L540)).

### 3.4 Post-import side effects

If at least one row was imported or updated, the import endpoint runs `redetectTransfers` synchronously (so its result can be returned in the response), then fires three background tasks (no await): `redetectInvestments`, `syncNetWorthFromTransactions`, and `autoGenerateBudgetGoals`. Failures of these background tasks are logged as warnings and never surface to the user.

The response payload is `{ imported, skipped, updated, errors, transferPairsDetected, message }`.

---

## 4. Transfer Detection

Defined in `redetectTransfers` at [artifacts/api-server/src/routes/transactions.ts:82](artifacts/api-server/src/routes/transactions.ts#L82). Executed automatically after each import and triggerable via `POST /api/transactions/redetect-transfers`.

### 4.1 Step 0 — Broad reset
All `isTransfer=true` rows are cleared. This guarantees the detector is the single source of truth — flags set by `isTransferCategory` during import (which only inspects the raw CSV category) are wiped before the more discriminating logic below runs.

### 4.2 Step 1 — Loan/mortgage credit absorption
Any transaction with `transactionType = 'transfer_incoming'` AND an `accountName` containing `"loan"` or `"mortgage"` (case-insensitive) is unconditionally flagged. The rationale is that money landing in a loan account is a repayment, not income — and the corresponding debit on the source account is the real expense to capture.

### 4.3 Step 2 — Category-confirmed transfers
Any transaction whose `categoryName` contains `"transfer"` or `"credit card payment"` is flagged, **unless** the user has overridden `userCategory` to something other than transfer/credit-card-payment. The SQL also explicitly excludes loan/mortgage account names so that Step 1 remains the source of truth for those rows. Concretely the predicate is:

```
(categoryName LIKE '%transfer%' OR categoryName LIKE '%credit card payment%')
AND (userCategory IS NULL
     OR userCategory LIKE '%transfer%'
     OR userCategory LIKE '%credit card payment%')
AND accountName NOT LIKE '%loan%'
AND accountName NOT LIKE '%mortgage%'
```

This is why setting `userCategory = "Mortgage"` on a transaction whose `categoryName = "Transfer Between Accounts"` will **prevent** it from being flagged as a transfer at this step — it becomes a real expense.

### 4.4 Step 3 — Amount-based pair matching
For every still-unflagged, `included=true` row that is **not** salary/wages/payroll/regular-income (those terms are checked against `userCategory ?? categoryName ?? ''`), the detector splits debits from credits, groups credits by exact amount string, and for each debit looks for the first unused credit at the same amount on a different `accountNumber` within ±3 days. Matching is greedy in date order; the first eligible pair wins. Both legs are then flagged.

The exclusion of salary/wages/payroll prevents a fortnightly pay credit from being accidentally paired with a coincidentally-equal debit elsewhere.

### 4.5 Grouped transfers view (`GET /api/transfers/grouped`)
Used by the Transfers tab. Independent of the detector: it pulls all `isTransfer=true, included=true` rows and pair-matches them in JavaScript using a "closest match within 3 days" rule (the bestGap heuristic at [line 387](artifacts/api-server/src/routes/transactions.ts#L387)). Unmatched legs are returned as `unpaired`, with an amber warning in the UI. The user can use the "Not transfers" button on a pair (or "Not a transfer" on a singleton) to flip `isTransfer` back to false on both sides.

---

## 5. Category Rules and Bulk Recategorisation

### 5.1 Rule lifecycle
Rules are managed at [/category-rules](artifacts/family-cfo/src/pages/category-rules.tsx). Each rule has a pattern, a field to match against, and a target `category`. Patterns support `|` (OR) and `&` (AND), evaluated by `matchesPattern` in both [transactions.ts:18](artifacts/api-server/src/routes/transactions.ts#L18) and [category-rules.ts:7](artifacts/api-server/src/routes/category-rules.ts#L7) (identical implementations). Comparison is always case-insensitive.

### 5.2 Rule application contexts
- **At import time**: the matcher runs for every row. For new rows it sets `userCategory` and overrides `categoryName`. For existing rows it sets `userCategory` only if it was previously NULL.
- **`POST /api/category-rules/apply`**: re-applies all active rules across the whole table. By default only fills in rows with `userCategory IS NULL`; pass `{ overwrite: true }` to re-apply on top of existing user overrides. First matching rule wins (rules iterated in `createdAt` order).
- **`POST /api/category-rules/preview`**: returns the count and sample of transactions a candidate pattern would match — used by the live preview pane in the Edit Rule dialog.

### 5.3 Single-transaction recategorisation and the "apply to similar" flow
When the user changes a category via the inline picker (on the Transactions page or the dashboard drilldown), the frontend issues `PATCH /api/transactions/:id` (which only touches that row), then immediately fetches `GET /api/transactions/:id/similar`.

The similar endpoint ([line 642](artifacts/api-server/src/routes/transactions.ts#L642)) computes:
- `descriptionTokens` — words from the description after stripping a NOISE_WORDS list (POS, AUTH, EFTPOS, PAYPAL, etc.), purely numeric tokens, masking characters, and card-number suffixes ([line 213](artifacts/api-server/src/routes/transactions.ts#L213)).
- `defaultCriteria` — if the source has a non-empty merchant name (not "Unknown"), the default is `[{type: merchant, value: merchantName}]`; otherwise it's the first two description tokens.

Results from `runSimilarQuery` summarise count, total amount, date range, current categories, and up to N samples. If the count is positive, the frontend opens the **BulkApplyDialog**.

The dialog presents chip-style toggleable criteria — merchant, individual description tokens, account, direction (credit/debit), and exact amount — and live-queries `POST /api/transactions/preview-similar` (debounced 300ms) as the user refines the selection.

On confirm, `POST /api/transactions/bulk-recategorize` runs an `UPDATE` with the assembled WHERE clause (`buildCriteriaConditions`) and, if `createRule=true`, persists a new `category_rules` row inferred from the chosen criteria:
- Merchant criterion → `matchField=merchant`, pattern is the merchant name.
- Description token criteria → `matchField=description`, pattern is all tokens joined by `|`.
- Otherwise an account fallback → `matchField=description`, pattern is the account name.

---

## 6. Investment Detection

Defined in `redetectInvestments` at [line 47](artifacts/api-server/src/routes/transactions.ts#L47) and used during both import (`csvIsInvestment`) and on-demand redetection.

A transaction is an investment when **all** of these hold:
- `creditDebit = 'debit'`
- `included = true`
- `isTransfer = false`
- Its category or description matches one of two pattern lists:

```
INVESTMENT_CATEGORY_PATTERNS:
  super, invest, shares, brokerage, managed fund, etf, securities

INVESTMENT_DESCRIPTION_PATTERNS:
  vanguard, commsec, pearler, selfwealth, raiz, spaceship, nabtrade,
  australiansuper, hostplus, host plus, unisuper, rest super, cbus,
  hesta, stake, superhero, betashares, ishares, magellan, argo invest, afic
```

Category patterns are tested against both `categoryName` and `userCategory`; description patterns against `description`. The on-demand re-runner first clears all `isInvestment=true` flags before reapplying — so a transaction the user manually flipped off via "Not investment" will be **re-flagged** on the next re-detection if it still matches a pattern. To make the change stick the user must change the category or description, or rely on the per-row toggle being preserved (note: app-managed `isInvestment` is preserved during CSV re-import but **reset** during explicit re-detection).

### 6.1 Fund-type classification
For per-fund analytics and AI summaries, `detectFundType` ([artifacts/api-server/src/routes/ai.ts:32](artifacts/api-server/src/routes/ai.ts#L32)) and a duplicate `detectFund` in [investments.ts:61](artifacts/api-server/src/routes/investments.ts#L61) match against a hard-coded list of Australian super funds (HostPlus, AustralianSuper, UniSuper, REST, CBUS, HESTA → `type=super`) and share platforms (Vanguard, BetaShares, iShares, Magellan, CommSec, Pearler, SelfWealth, Raiz, Spaceship, nabtrade, Stake, Superhero, Argo, AFIC → `type=shares`). If no exact match, a category fallback applies: anything mentioning "super" becomes `Super (Other)`; anything mentioning invest/shares/brokerage/ETF becomes `Shares / ETFs`; otherwise `Other Investments` (typed as shares).

---

## 7. Dashboard

The dashboard route ([artifacts/family-cfo/src/pages/dashboard.tsx](artifacts/family-cfo/src/pages/dashboard.tsx)) issues seven parallel queries (summary, prior-month summary, cashflow, spending-by-category, accounts, forecast, AI insights, recent transactions) and aggregates them into a single command-centre view. All API queries take a `startDate`/`endDate` window driven by the date filter (month navigator, six presets, custom range).

### 7.1 `GET /api/dashboard/summary`
At [artifacts/api-server/src/routes/dashboard.ts:9](artifacts/api-server/src/routes/dashboard.ts#L9). For each `included=true` row in the window:
- `isTransfer=true` → counted in `transfersFiltered`, otherwise ignored.
- `isInvestment=true AND debit` → counted in `investmentsFiltered`, added to `totalInvested`, bucketed in `investCategoryTotals[userCategory ?? categoryName ?? "Investments"]`.
- `credit` → added to `totalIncome`.
- `debit` (everything else) → added to `totalExpenses`, bucketed in `categoryTotals[userCategory ?? categoryName ?? "Uncategorised"]`.

Derived: `netCashflow = income − expenses − invested`; `savingsRate = (netCashflow / income) × 100`. Top-8 categories are returned with percentages.

### 7.2 `GET /api/dashboard/cashflow`
The heart of the cashflow chart. Before iterating transactions it loads all linked **savings asset accounts** (i.e. `net_worth_accounts` where `type='asset' AND category='savings' AND isLinked=true`) and gathers their `linkedAccountNumber`s into a Set — the "mortgage goal" identifiers.

Per row, monthly bucket assembled (`monthlyMap[YYYY-MM]`):
- `isTransfer=true` AND `accountNumber` is a mortgage-goal identifier → `mortgageGoalOffset += sign × amount` where sign is +1 for credits and −1 for debits (net flow into the offset bucket).
- `isTransfer=true` otherwise → `transfers += amount` (returned but not used in the chart).
- `isInvestment=true AND debit` → `investments += amount` and the per-category `investmentBreakdown` is tracked.
- Plain `credit` → `income`.
- Plain `debit` → `expenses`.

Then per month: `savings = income − expenses − investments` and `freeCash = savings − mortgageGoalOffset`. The chart stacks the cashflow into bars: income (green), expenses (red), investments (purple, broken out by sub-category), mortgage goal (cyan, stacked under free cash), and free cash (blue). Every bar is clickable and opens the corresponding drilldown sheet.

If `startDate`/`endDate` are supplied all months in that range are returned; otherwise the last N months (default 12) are returned in ascending order. `averageIncome` / `averageExpenses` / `averageSavings` are the trailing averages over the returned months.

The dashboard renders dashed linear-regression trend lines for income and expenses over the visible months when there are ≥3 data points (`linearTrend` function at [dashboard.tsx:84](artifacts/family-cfo/src/pages/dashboard.tsx#L84)).

### 7.3 `GET /api/dashboard/spending-by-category`
Sums `isTransfer=false AND isInvestment=false AND debit AND included=true` rows, bucketed by `userCategory ?? categoryName ?? "Uncategorised"`. Sorted descending; powers the donut chart on the dashboard.

### 7.4 `GET /api/dashboard/accounts`
Groups all `included=true` transactions by `(accountNumber, accountName, providerName)` and emits credits/debits totals and a `lastActivity` date. Sorted by `totalCredits` descending.

### 7.5 `GET /api/dashboard/category-drilldown`
Drives the Income / Expenses / Investments drilldown sheets. Filters depend on `type`:
- `income` — credits, excluding transfers and investments.
- `expenses` — debits, excluding transfers and investments.
- `investments` — debits with `isInvestment=true`.

Returns a category breakdown identical in shape to the summary endpoint.

### 7.6 `GET /api/dashboard/offset-drilldown`
Returns every transaction on a savings-asset account in the date window, sorted ascending. `netFlow` is `Σcredits − Σdebits`. This is what populates the cyan "Mortgage Goal" bar drilldown — letting the user see the actual contributions and any withdrawals.

### 7.7 `GET /api/dashboard/forecast`
End-of-month projection from [dashboard.ts:437](artifacts/api-server/src/routes/dashboard.ts#L437):

1. Loads every `included=true, isTransfer=false` row.
2. Filters out investments (debits only — credits like dividends are kept as income).
3. Splits into "current month" rows (date prefix matches today's `YYYY-MM`) and historical rows.
4. Computes `currentMonthSpend`, `currentMonthIncome`.
5. Computes `avgMonthlyIncome` and `avgMonthlyExpense` over all historical months.
6. **Daily spend rate** = `max(currentMonthSpend / dayOfMonth, avgMonthlyExpense / daysInMonth)` — the greater of "this month's pace so far" and "the long-run average". This biases the forecast to be at least as pessimistic as the historical average.
7. `projectedMonthSpend = currentMonthSpend + dailySpendRate × daysRemaining`.
8. `surplusCurrentMonth = avgMonthlyIncome − projectedMonthSpend`. The `onTrackMessage` is either "you will save $X by end of month" or "you will overspend by $X this month".
9. `runwayMonths` is 999 when the household runs a surplus; otherwise `avgMonthlyIncome / |monthlySurplus|`.

### 7.8 KPI cards and month-on-month deltas
When the date filter is the month navigator, the dashboard fires a second summary query for the prior month and renders `ChangePill` deltas (`pctChange(current, prev)`). For expenses, the pill is "invert-coloured" — an increase shows red, a decrease shows green.

---

## 8. Budget Goals

Code: [artifacts/api-server/src/routes/budget.ts](artifacts/api-server/src/routes/budget.ts).

### 8.1 Auto-generation algorithm

`autoGenerateBudgetGoals` runs on every successful import and on `POST /api/budget/auto-generate`. It looks at the last twelve calendar months of debits where `isTransfer=false` and groups by `coalesce(userCategory, categoryName, 'Uncategorised') × YYYY-MM`. For each category it then computes `(monthsSeen, totalSpent)`.

A category becomes a candidate goal when **all** of the following hold:
- The category name lower-cased is **not** in the EXCLUDED set: `uncategorised`, `transfer between accounts`, `credit card payment`, `credit card payments`.
- It appears in **≥2** distinct months (`MIN_MONTHS`).
- Its average monthly spend is **≥ AUD 30** (`MIN_MONTHLY_AVG`).

For each candidate:
- `avgMonthly = total / monthsSeen`.
- `monthlyLimit = ceil((avgMonthly × 1.10) / 10) × 10` — i.e. 10% buffer, then rounded **up** to the nearest $10.

Then the upsert logic:
- If a goal already exists and `userEdited=true` → only the `avgMonthlySpend` reference is updated, the `monthlyLimit` is **never** overwritten (`skipped++`).
- If a goal exists and `userEdited=false` → both limit and average are refreshed, `source` re-stamped as `auto` (`updated++`).
- If no goal exists → inserted as `source=auto, userEdited=false` (`created++`).

This is the rule that makes manual tweaks sticky: as soon as the user edits a limit via `PUT /api/budget/goals/:id` or the inline editor, the system sets `userEdited=true` and the auto-generator will never replace it.

### 8.2 Status calculation

`GET /api/budget/status?month=YYYY-MM` returns the per-category state for a target month:
1. Computes the month's start/end date strings.
2. Aggregates spend by `coalesce(userCategory, categoryName, 'Uncategorised')` over `debit AND isTransfer=false` rows in the window. (Note: `isInvestment` is **not** filtered here, so an investment-flagged debit will still appear under its category's budget spend — relevant if a user has a "Super" budget goal.)
3. For each goal, looks up `spent` by exact lower-cased category match. If zero, a fuzzy fallback iterates the spending map looking for either side containing the other (`goalCategory.includes(spendingCategory)` or vice versa) — this catches `"Groceries"` matching `"groceries"` after Frollo variation.
4. `remaining = limit − spent`; `percentUsed = (spent / limit) × 100` (capped at 999 in the response); `isOverBudget = spent > limit`.

### 8.3 Manual create / update

`POST /api/budget/goals` upserts by case-insensitive category match (using `ilike`). Any creation here is `source=manual, userEdited=true`. `PUT /api/budget/goals/:id` updates the limit and sets `userEdited=true` (but keeps the existing `source`).

### 8.4 Budget page UI
The header shows a four-tile strip: Total Budgeted, Spent (current month), Avg Monthly Income (from 12-month cashflow), and Budget vs Income percentage. The "budget health bar" overlays the spent amount against income, with a white marker at the total-budgeted limit. If `totalBudgeted > avgMonthlyIncome` the bar turns red and a warning surfaces.

Note: only the current month is selectable in the month navigator (`getLast13Months` is hard-coded to return only `i=0` in [budget.tsx:41](artifacts/family-cfo/src/pages/budget.tsx#L41) — this looks like a holdover loop but in practice the user is locked to the current month).

---

## 9. Net Worth

Code: [artifacts/api-server/src/routes/net-worth.ts](artifacts/api-server/src/routes/net-worth.ts).

### 9.1 Sync from transactions

`syncNetWorthFromTransactions` runs after each import and on `POST /api/net-worth/sync`. For every distinct `accountNumber` in `transactions`, it:

1. Sums all credits and all debits across the entire transaction history (no date window, no `included` filter).
2. Computes `netFlow = totalCredits − totalDebits`.
3. If a `net_worth_accounts` row already has `linkedAccountNumber` matching, updates its `currentBalance = baseBalance + netFlow`.
4. Otherwise creates a new linked account with `baseBalance=0`, `currentBalance=netFlow`, `balanceSource='derived'`, `isLinked=true`. Type is inferred from sign: `netFlow ≥ 0 → asset`, else `liability`. Category comes from `inferCategory(name, type)`:

```
"super" / "retirement" → super
"saver" / "savings" / "term deposit" / "offset" → savings
"credit" / "card" / "visa" / "mastercard" → credit_card (liability) or bank_account (asset)
"home loan" / "mortgage" / "homeloan" → home_loan
"car" / "vehicle" / "auto" → car_loan (liability) or vehicle (asset)
"personal loan" → personal_loan
fallback: bank_account or other_liability
```

5. After processing newly seen accounts, it re-iterates all `isLinked=true` accounts and refreshes their balance (this catches manual `baseBalance` changes the user made).
6. Calls `takeSnapshot` to upsert today's row in `net_worth_snapshots`. The snapshot stores totals plus a per-account `breakdown` JSON array.

### 9.2 Manual accounts

Created via `POST /api/net-worth/accounts` with `balanceSource='manual'` and `isLinked=false`. Used for assets (property, super balance, share portfolios, vehicles) and liabilities (home loan principal, etc.) that aren't on a Frollo-tracked card or transaction account. These are never overwritten by sync.

### 9.3 Summary and history

`GET /api/net-worth/summary` returns the asset/liability totals and accounts list. `monthlyChange` is the difference between the most recent snapshot and the one before it — confusingly named, because adjacent snapshots are daily, not monthly; the value reflects the change since the previous saved snapshot (typically yesterday or the previous import day).

`GET /api/net-worth/history` returns up to 60 snapshots in ascending date order for the trend chart.

---

## 10. AI Insights & Chat

Code: [artifacts/api-server/src/routes/ai.ts](artifacts/api-server/src/routes/ai.ts).

### 10.1 Rule-based insights (`GET /api/ai/insights`)

Loads all `included=true, isTransfer=false` rows plus the `getInvestmentSummary()` aggregation. Computes the last 6 months of income/expenses and a category-totals map.

Insights are generated as plain objects with `id`, `type`, `title`, `message`, `impact`, `priority`. The maximum five returned are sorted by ascending priority:

| Priority | Condition | Title |
| --- | --- | --- |
| 1 | `investmentSummary.totalInvested > 0` | "Investing $X/month" |
| 1 | `savingsRate < 10 AND avgIncome > 0` | "Low savings rate alert" (type=warning) |
| 2 | `superTotal > 3 × sharesTotal AND sharesTotal > 0` | "Portfolio is super-heavy" |
| 3 | `savingsRate > 15 AND avgIncome > 0` | "Strong savings runway" |
| 4 | always | "True average monthly spend" |
| 5 | always (if any expenses) | "Top spending category: X" |
| 6 | always | "End-of-year projection" |

`investmentRate = (avgMonthlyInvestment / avgIncome) × 100`. `savingsRate = ((avgIncome − avgExpenses) / avgIncome) × 100`. The Top Spending Category metric uses **total all-time** category spend (not the trailing 6 months) but compares it against trailing-6-months expenses for the percentage figure — be aware this can yield percentages over 100% for long-lived categories.

### 10.2 Streaming chat (`POST /api/ai/chat`)

Body: `{ message, conversationHistory }`. The endpoint:

1. Computes the same monthly aggregations used by the insights endpoint, except investments are excluded from expenses (`if !row.isInvestment`). Transfers are always excluded.
2. Builds the **system prompt** with real numbers injected:

```
## Cash Flow (monthly averages over N months)
- Average monthly income: $X
- Average monthly expenses (excl. investments): $X
- Average monthly investments: $X
- True monthly surplus: $X
- Savings rate: X%
- Investment rate: X%

## Top Spending Categories (all time)
  - Category: $X (top 5)

## Investment Portfolio
- Total invested, super/shares split, monthly average, top funds
```

3. Calls `anthropic.messages.stream({ model: "claude-sonnet-4-6", max_tokens: 8192, system, messages })`.
4. Streams `content_block_delta` events back over Server-Sent Events as `data: {"content": "..."}\n\n`, terminating with `data: {"done": true}\n\n`.

The advice guidelines section of the system prompt explicitly instructs the model to use the injected numbers, to factor in super preservation age, and to be direct and analytical. Conversation history is not persisted server-side; the client is responsible for maintaining and re-sending it.

---

## 11. Scenario Engine

Code: [artifacts/api-server/src/routes/scenarios.ts](artifacts/api-server/src/routes/scenarios.ts), driven by the Scenarios page.

Baseline: all-time monthly averages of income and expenses from `included=true, isTransfer=false` rows. Note: **investments are not excluded** from the baseline expenses figure here (unlike the AI chat) — a household investing heavily will see their "baseline expenses" inflated.

Five scenario types apply a different transformation to scenario income/expenses:

| Type | Lever | Effect |
| --- | --- | --- |
| `income_change` | `incomeChangePercent` | `scenarioIncome = base × (1 + pct/100)` |
| `new_expense` | `newMonthlyExpense`, `expenseLabel` | `scenarioExpenses = base + amount` |
| `investment` | `investmentAmount` | `scenarioExpenses = base + amount/12` (spread one-off across the year) |
| `debt_payoff` | `debtAmount`, `debtInterestRate` (default 5%) | Amortised over 60 months at the monthly rate; that monthly payment is added to expenses |
| `holiday` | `holidayBudget` | `scenarioExpenses = base + holidayBudget / projectionMonths` |

`projectionMonths` defaults to 12. The response includes:
- `currentSavingsRate`, `newSavingsRate`
- `monthlyCashflowImpact = scenarioSurplus − currentSurplus`
- `runwayMonthsCurrent`, `runwayMonthsNew` — 999 when in surplus, otherwise `income / |surplus|`
- `monthlyProjection` — N months of `{ income, expenses, savings, cumulativeSavings }`, all derived from a flat repeat of the scenario figures (no inflation or seasonality modelling).

---

## 12. Accounts Page

Backed by `GET /api/accounts` and `PATCH /api/accounts/:accountNumber`. The list endpoint groups distinct `(accountName, accountNumber, providerName)` tuples from transactions and joins each to the `account_preferences.skipped` flag.

Toggling an account fires the PATCH, which:
1. Upserts `account_preferences` keyed on `accountNumber` with the new `skipped` value.
2. Issues a bulk `UPDATE transactions SET included = NOT skipped WHERE account_number = ?`.

The `included` flag is the master gate for nearly every analytical query (dashboard, cashflow, budget, insights, chat, scenarios, net worth sync), so skipping an account immediately removes all its transactions from every view without deleting any rows.

---

## 13. Transaction Filtering

The Transactions page (`artifacts/family-cfo/src/pages/transactions.tsx`) provides multiple filtering options via `GET /api/transactions` query parameters:

### 13.1 Supported filters
- **Text search** (`search`) — full-text match across `description`, `userDescription`, and `merchantName` using case-insensitive substring.
- **Account** (`accountName`) — filter by account name (case-insensitive substring).
- **Category** (`category`) — filter by category name; matches both `categoryName` and `userCategory` (case-insensitive substring).
- **Credit/Debit** (`creditDebit`) — restrict to `"credit"` or `"debit"` only.
- **Date range** (`startDate`, `endDate`) — filter by transaction date (ISO format `YYYY-MM-DD`). Both are optional; date matching is `gte` (start) and `lte` (end) inclusive.
- **Amount range** (`minAmount`, `maxAmount`) — filter by transaction amount (numeric). Both are optional; amount comparison uses numeric inequality operators.
- **Flags** (`isTransfer`, `isRecurring`, `isInvestment`) — exact boolean matches (used internally by Transfers and Investments tabs).

All filters are combined with AND logic (multiple filters narrow the result set).

### 13.2 UI implementation
The Transactions tab displays two rows of filter controls:
1. **Row 1**: Search text, Account name, Category, Credit/Debit
2. **Row 2**: Date From (HTML5 date input), Date To, Min Amount (number input), Max Amount (number input)

A "Clear filters" button appears when any date or amount filter is active, resetting all four fields.

### 13.3 Truncated text tooltips
Description, merchant, and account name fields in transaction rows are truncated to a maximum width and display ellipses (`…`) when text overflows. Hovering over any truncated field shows a styled tooltip (powered by Radix UI) displaying the full text. This applies across:
- Main Transactions table (description, merchant, account name)
- Investments table (description, merchant, account name)
- Transfers tab (outgoing/incoming descriptions and account names)
- Unpaired transfers section (description and account info)

---

## 14. Cross-Cutting Behaviour and Decision Order

When tracing why a specific transaction was or wasn't categorised a certain way, walk through this canonical decision order. Each step can override earlier outcomes.

### 14.1 At import time
1. Was the row's `transaction_id` already present? If yes, go to **3.3 update path** (only bank fields change, app fields preserved).
2. Otherwise, do any active category rules match (merchant → description → category, first match wins)? If yes, `categoryName` becomes the rule's category AND `userCategory` is seeded with it. If no, the bank's raw `categoryName` is stored.
3. Is the CSV `category_name` `"transfer"`-ish? If yes, `isTransfer = true` initially.
4. Is the row a debit AND does its category or description match any investment pattern? If yes, `isInvestment = true`.

### 14.2 Post-import (always re-runs after any insert/update)
5. **All** `isTransfer` flags are cleared.
6. `transactionType='transfer_incoming'` on a loan/mortgage account → `isTransfer=true`.
7. `categoryName` contains transfer/credit-card-payment (and `userCategory` doesn't override it, and account isn't loan/mortgage) → `isTransfer=true`.
8. Remaining unflagged rows are pair-matched by amount + ±3 days + different account; salary/wages/payroll/regular-income are excluded from candidacy. Matched pairs both get `isTransfer=true`.
9. **All** `isInvestment` flags cleared and re-applied based on current patterns against debit/included/non-transfer rows.

### 14.3 At analytics-query time
10. `included=false`? → invisible everywhere.
11. `isTransfer=true`? → excluded from income/expense maths; counted in `mortgageGoalOffset` only if the account is a linked savings-asset account.
12. `isInvestment=true AND debit`? → counted as investments, not expenses.
13. Otherwise, `credit → income`, `debit → expenses`. Categorisation in summaries always prefers `userCategory ?? categoryName ?? "Uncategorised"`.

### 14.4 Common miscategorisation patterns
- **A transaction shows as a transfer but shouldn't**: most often this happens because `categoryName` literally contains "transfer". Setting `userCategory` to anything that doesn't contain "transfer" or "credit card payment" will unflag it (after the next re-detection). Alternatively, manually toggle `isTransfer=false` — but the flag will be reset on the next import or re-detection unless the category text is also changed.
- **A mortgage repayment shows as an expense rather than a transfer**: it is on a debit-from-checking → credit-to-loan-account pair. Step 1 of the detector catches the *incoming* leg on the loan account. The *outgoing* leg from the checking account is only matched by Step 3 (amount pair-matching within 3 days). If that fails (e.g. dates are >3 days apart or there's no loan-account leg in the data), the debit will show as a normal expense; the user must manually set `userCategory='Mortgage'` (or another non-transfer value) and rely on the categorisation, or use the Transfers tab "Mark as transfer" toggle.
- **An investment shows as a regular expense**: the category and description don't contain any of the investment patterns. Either add a category rule that emits a category like "Investments — Vanguard" (any string with `invest` in it) or manually set `userCategory` to something matching, then run Re-detect Investments. Importantly the toggle "Not investment" will be **reversed** the next time re-detection runs if the row still matches; this requires changing the underlying text.
- **A budget category shows zero spending despite obvious transactions**: the goal's category name doesn't exactly match (after lower-casing) the `userCategory ?? categoryName` of the transactions. The fuzzy fallback in §8.2 only matches when one string contains the other; mismatched names (e.g. "Dining Out" vs "Restaurants") won't match.
- **Savings rate looks wrong**: investments are subtracted from net cashflow in the summary (§7.1) but **not** in the `savingsRate` formula on the AI insights page (§10.1), which uses `(income − expenses) / income` excluding investments from expenses. The two figures can disagree by the investment portion.

---

## 15. End-to-end Request Examples

### 15.1 Importing a fresh CSV
1. Browser reads the file, POSTs `{ csvContent }` to `/api/transactions/import`.
2. Server parses, loops rows, inserts new ones (applying rules), skips/updates existing ones.
3. `redetectTransfers` runs synchronously; the response includes `transferPairsDetected`.
4. Three background tasks fire-and-forget: `redetectInvestments`, `syncNetWorthFromTransactions` (which also takes today's snapshot), `autoGenerateBudgetGoals`.
5. Frontend invalidates `useListTransactions` cache; new data appears across all pages on next query.

### 15.2 Rendering the dashboard for "October 2026"
1. Date filter produces `startDate=2026-10-01, endDate=2026-10-31`.
2. Eight parallel API queries fire (summary, prior-month summary for September, cashflow, spending-by-category, accounts, forecast, AI insights, recent transactions).
3. The cashflow query identifies mortgage-goal account numbers, sums credits to them per month, exposes `mortgageGoalOffset` and `freeCash` per bar.
4. Clicking the Income bar opens the drilldown sheet → fetches `/api/dashboard/category-drilldown?type=income&startDate=…&endDate=…` → shows categories; clicking a category fetches the transactions list filtered by `category + creditDebit=credit + isTransfer=false + isInvestment=false`.

### 15.3 Re-categorising "WOOLWORTHS METRO" from Groceries to Dining
1. User clicks the category badge on a single transaction → `PATCH /api/transactions/:id { userCategory: "Dining" }`.
2. Frontend immediately fetches `/api/transactions/:id/similar`.
3. Endpoint extracts merchant `Woolworths Metro`, returns 47 similar transactions (the merchant criterion is default).
4. BulkApplyDialog opens with merchant chip pre-selected, showing live count and samples.
5. User confirms with "Apply + create rule" → `POST /api/transactions/bulk-recategorize`.
6. All 47 transactions get `userCategory='Dining'`; a new `category_rules` row is created with `matchField=merchant, matchPattern='Woolworths Metro', category='Dining'`.
7. On any future import, the new rule fires before insert: any new Woolworths Metro transaction is stored with `categoryName='Dining'` and `userCategory='Dining'`.
