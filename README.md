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

## Desktop till (Tauri)

The till runs the web app inside a small desktop shell that can print raw ESC/POS to the XP-Q80 and open the cash drawer.

```bash
npm run dev          # web app on :3000 (keep running)
npm run till:dev     # opens the desktop till at /till
npm run till:build   # installers: .msi/.exe on Windows, .dmg on macOS
```

On the till, click **Printer** in the top bar, pick the XP-Q80, and print a test slip. Needs Rust (`rustup`). Windows installers must be built on Windows (the icon step needs Windows' resource compiler). Before shipping, point `app.windows[0].url` in `src-tauri/tauri.conf.json` at the deployed site.

## Receiving stock by scanning

Stock → Receive stock → start a delivery (supplier, invoice number, VAT mode) → scan.

- Known barcode: quantity goes up by one per scan (or type the quantity).
- New barcode: looked up in the shared barcode library, then Open Beauty Facts / Open Food Facts, then UPCitemdb (free tier, ~100/day). Name, brand and photo are prefilled; staff set retail and wholesale prices (they apply immediately) and the cost from the invoice. It can be added as a new shade of an existing product.
- No barcode: "No barcode" creates the product with an in-store EAN-13 for labels.
- Photos: "Add photo" shows a QR code; the phone takes the picture and it appears on the till. Needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. On a local dev server the QR uses this computer's network address, so the phone must be on the same Wi-Fi.
- Saving the delivery posts a normal supplier bill (stock in, Accounts Payable up). Every line needs a cost first.

Barcode lookups use data from Open Beauty Facts and Open Food Facts (ODbL) and UPCitemdb.
