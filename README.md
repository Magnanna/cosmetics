# Kenfri POS

Point of sale and books for Kenfri Cosmetics. Next.js 15 + Supabase Postgres + Drizzle, with a Tauri desktop shell for the till (coming in week 2).

- Product spec: [`tasks/prd-kenfri-pos.md`](tasks/prd-kenfri-pos.md)
- Illustrated overview: [`docs/blueprint/`](docs/blueprint/index.html)

## Run it

```bash
cp .env.example .env.local   # fill in the Supabase values
npm install
npm run db:migrate           # applies drizzle/ migrations and locks tables behind RLS
npm run db:seed              # Kenfri org, chart of accounts, shop, till, categories (idempotent)
npm run dev                  # http://localhost:3000 — first visit /setup to create the owner
```

Tests: `npm test` (pure maths) · `npm run test:db` (ledger + FIFO against the real database, always rolled back)

## How the money works

Everything is a journal. `src/lib/ledger.ts` is the only writer to `journal_entries` / `journal_lines`, and every posting takes the caller's transaction — a sale, its stock movement and its journal commit together or not at all.

- `src/lib/inventory.ts` — FIFO lots that track remaining qty **and** remaining cost, so stock value always equals the Inventory account. Overselling creates a deficit lot that the next receipt settles, posting the cost difference to COGS.
- `src/lib/landed-cost.ts` — Kenfri isn't VAT registered, so supplier VAT is part of stock cost. Handles VAT-inclusive (Lush) and VAT-exclusive supplier rates.
- `src/lib/coa.ts` — chart of accounts for a Turnover Tax retailer.
- `src/lib/permissions.ts` — role → permission matrix, enforced server-side in every action.
- Money is integer cents; quantities are whole units; loyalty points are stored in hundredths.

## Security model

The app talks to Postgres directly from the server. Every public table has RLS enabled with no policies, so the Supabase REST API (anon/authenticated keys) can read nothing. Org scoping is enforced in code: every query filters by `org_id` from the signed-in member's session.
