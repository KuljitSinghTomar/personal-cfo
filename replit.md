# Family CFO

A Personal CFO-style finance tool for families. Provides a command center style, decision-grade dashboard built for financially sophisticated users who want real numbers, real predictions, and real intelligence.

## Architecture

- **Frontend**: React + Vite (`artifacts/family-cfo/`) at path `/`
- **Backend**: Express API server (`artifacts/api-server/`) at path `/api`
- **Database**: PostgreSQL via Drizzle ORM (`lib/db/`)
- **AI**: Claude (claude-sonnet-4-6) via Replit AI Integrations (`lib/integrations-anthropic-ai/`)
- **API Contract**: OpenAPI spec in `lib/api-spec/openapi.yaml`, codegen via Orval

## Pages

- `/` — Dashboard: Command centre with KPI cards, cash flow chart (bar chart, 12 months), AI insights panel, spending by category (donut), accounts summary, recent transactions
- `/transactions` — Transaction list with filters, search, CSV import, one-click toggle for Transfer/Recurring flags
- `/budget` — Budget Goals: auto-generated from 12-month history, inline editing, auto/manual/edited badges, regenerate button
- `/net-worth` — Net Worth: assets + liabilities tracker, auto-derived balances from transactions, history chart, manual account management
- `/ai-advisor` — Streaming AI chat with pre-loaded suggested questions (powered by Claude)
- `/scenarios` — Scenario engine with sliders/inputs, month-by-month projection line chart, savings rate delta

## Key Features

- **Frollo CSV ingestion**: JSON endpoint (`POST /api/transactions/import`) accepting raw CSV content. Deduplication by `transaction_id` — skips unchanged, updates changed rows. After import fires budget auto-generation + net worth sync (fire-and-forget).
- **Internal transfer detection**: Auto-detected from `transaction_type` (transfer_incoming/outgoing) and `category_name` containing "transfer" or "credit card payment"
- **Cash flow forecasting**: Real daily spend rate extrapolated to end-of-month
- **AI Insights**: Rule-based generation from real transaction data (savings rate, category analysis, projections)
- **Streaming AI chat**: Real SSE stream from Claude with full financial context injected
- **Scenario engine**: Income change, new expense, investment, debt payoff, holiday budget simulations with monthly projections
- **Budget Goals**: Auto-generated from last 12 months of debits (10% buffer, $10 rounding). User edits are locked from auto-overwrite. Regenerate button.
- **Net Worth Tracker**: Accounts auto-detected from CSV imports. Derived balance = base_balance + (credits - debits). Manual accounts (property, super, shares) added separately. Snapshots saved for trend chart.

## Database Schema

- `transactions` — Full Frollo CSV field mapping, unique on `transaction_id`, includes `is_transfer`, `is_recurring`, `user_category`, `user_tags`, `ai_confidence_score`
- `budget_goals` — id, category (unique), monthly_limit, source (auto/manual), avg_monthly_spend, user_edited (bool)
- `net_worth_accounts` — id, name, institution, type (asset/liability), category, current_balance, base_balance, balance_source (derived/manual), linked_account_number, is_linked
- `net_worth_snapshots` — id, snapshot_date (YYYY-MM-DD), total_assets, total_liabilities, net_worth, breakdown (jsonb)

## API Routes

- `GET /api/transactions` — list with filters (page, limit, search, category, creditDebit, isTransfer, isRecurring)
- `POST /api/transactions/import` — Frollo CSV import (JSON body: `{ csvContent }`)
- `PATCH /api/transactions/:id` — update transaction flags and user data
- `GET /api/dashboard/summary` — KPI aggregates
- `GET /api/dashboard/cashflow` — monthly cashflow data for chart
- `GET /api/dashboard/spending-by-category` — category breakdown
- `GET /api/dashboard/accounts` — accounts summary
- `GET /api/dashboard/forecast` — end-of-month projection
- `GET /api/ai/insights` — rule-based AI insights from transaction data
- `POST /api/ai/chat` — streaming SSE AI chat (Claude sonnet-4-6)
- `POST /api/scenarios/simulate` — financial scenario simulation
- `GET /api/budget/goals` — list budget goals
- `POST /api/budget/goals` — create goal
- `PUT /api/budget/goals/:id` — update goal (marks user_edited=true)
- `DELETE /api/budget/goals/:id` — delete goal
- `POST /api/budget/auto-generate` — auto-generate from 12 months of transaction history
- `GET /api/budget/status` — current month spend vs goals
- `GET /api/net-worth/accounts` — list net worth accounts with totals
- `POST /api/net-worth/accounts` — create manual account
- `PUT /api/net-worth/accounts/:id` — update account (name, balance, notes)
- `DELETE /api/net-worth/accounts/:id` — delete account
- `GET /api/net-worth/summary` — totals + monthly change
- `GET /api/net-worth/history` — snapshots for trend chart
- `POST /api/net-worth/sync` — re-derive balances from transactions
- `POST /api/net-worth/snapshot` — save today's snapshot manually

## Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL connection
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Anthropic via Replit AI Integrations
- `SESSION_SECRET` — Session secret (available but not currently used for auth since this is a no-login family tool)

## Design

- Dark-first palette: deep navy background (`220 20% 8%`), emerald green primary (`160 84% 39%`), blue/purple chart colors
- Information-dense, cockpit aesthetic
- Fully responsive: sidebar collapses to top nav on mobile

## Codegen Notes

- Pre-existing typecheck error in `lib/integrations-anthropic-ai` (unrelated, from platform) — codegen still succeeds
- Always call mutations as `mutate({ data: body })` — Orval wraps mutation bodies in `{ data: ... }`
