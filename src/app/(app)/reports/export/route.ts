import { db } from "@/db";
import { getSession, inOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/reports";
import { DIMENSIONS, salesBy, type SalesDimension } from "@/lib/sales-reports";
import { nairobiDate } from "@/lib/time";

const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (c: number) => (c / 100).toFixed(2);
function csv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : String(c))).join(",")).join("\n");
}

/** CSV downloads for the accountant. Same numbers as the screens. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports.view")) return new Response("Not allowed", { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const today = nairobiDate();
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : `${to.slice(0, 8)}01`;
  const asOf = isDate(url.searchParams.get("asOf")) ? url.searchParams.get("asOf")! : today;

  let rows: (string | number)[][];
  let name: string;
  if (kind === "pnl") {
    const r = await inOrg(s, () => profitAndLoss(db, from, to));
    rows = [["Section", "Account", "KES"]];
    for (const sec of [r.sales, r.lessSales, r.costOfSales, r.expenses]) for (const l of sec.lines) rows.push([sec.label, l.name, money(l.cents)]);
    rows.push(["", "Net sales", money(r.netSalesCents)], ["", "Gross profit", money(r.grossProfitCents)], ["", "Net profit", money(r.netProfitCents)]);
    name = `profit-and-loss_${from}_${to}`;
  } else if (kind === "bs") {
    const r = await inOrg(s, () => balanceSheet(db, asOf));
    rows = [["Section", "Account", "KES"]];
    for (const sec of [r.assets, r.liabilities, r.equity]) for (const l of sec.lines) rows.push([sec.label, l.name, money(l.cents)]);
    rows.push(["Owner's stake", "Profit to date", money(r.profitToDateCents)]);
    name = `balance-sheet_${asOf}`;
  } else if (kind === "tb") {
    const r = await inOrg(s, () => trialBalance(db, asOf));
    rows = [["Code", "Account", "Debit", "Credit"], ...r.rows.map((x) => [x.code, x.name, money(x.debitBalance), money(x.creditBalance)]), ["", "Total", money(r.debitCents), money(r.creditCents)]];
    name = `trial-balance_${asOf}`;
  } else if (kind === "sales") {
    const by = (url.searchParams.get("by") ?? "category") as SalesDimension;
    if (!(by in DIMENSIONS)) return new Response("Unknown grouping", { status: 400 });
    const r = await inOrg(s, () => salesBy(db, from, to, by));
    const costs = can(s.role, "catalog.view_costs");
    rows = [[DIMENSIONS[by], "Units", "Sales KES", ...(costs ? ["Cost KES", "Margin %"] : [])], ...r.map((x) => [x.label, x.units, money(x.netCents), ...(costs ? [money(x.costCents), x.marginPct ?? ""] : [])])];
    name = `sales-by-${by}_${from}_${to}`;
  } else {
    return new Response("Unknown report", { status: 400 });
  }
  return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
}
