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
- `/ai-advisor` — Streaming AI chat with pre-loaded suggested questions (powered by Claude)
- `/scenarios` — Scenario engine with sliders/inputs, month-by-month projection line chart, savings rate delta

## Key Features

- **Frollo CSV ingestion**: JSON endpoint (`POST /api/transactions/import`) accepting raw CSV content. Deduplication by `transaction_id` — skips unchanged, updates changed rows.
- **Internal transfer detection**: Auto-detected from `transaction_type` (transfer_incoming/outgoing) and `category_name` containing "transfer" or "credit card payment"
- **Cash flow forecasting**: Real daily spend rate extrapolated to end-of-month
- **AI Insights**: Rule-based generation from real transaction data (savings rate, category analysis, projections)
- **Streaming AI chat**: Real SSE stream from Claude with full financial context injected
- **Scenario engine**: Income change, new expense, investment, debt payoff, holiday budget simulations with monthly projections

## Database Schema

- `transactions` table: Full Frollo CSV field mapping, unique on `transaction_id`, includes `is_transfer`, `is_recurring`, `user_category`, `user_tags`, `ai_confidence_score`

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

## Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL connection
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Anthropic via Replit AI Integrations
- `SESSION_SECRET` — Session secret (available but not currently used for auth since this is a no-login family tool)

## Design

- Dark-first palette: deep navy background (`220 20% 8%`), emerald green primary (`160 84% 39%`), blue/purple chart colors
- Information-dense, cockpit aesthetic
- Fully responsive: sidebar collapses to top nav on mobile
