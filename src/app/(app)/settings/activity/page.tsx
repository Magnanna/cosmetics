import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import { db, auditLog, members } from "@/db";
import { requirePage } from "@/lib/auth";
import { nairobiDate } from "@/lib/time";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Plain-language names for audit actions. Unknown actions show their code. */
const LABELS: Record<string, string> = {
  "product.create": "Created a product", "product.create_from_scan": "Created a product while receiving", "product.update": "Edited a product", "product.archive": "Archived a product",
  "variant.update": "Edited a variant", "variant.archive": "Archived a variant", "variant.create": "Added a variant",
  "price.change": "Changed a price", "price.suggest": "Suggested a price", "price.approve": "Approved a price", "price.reject": "Rejected a price",
  "barcode.add": "Added a barcode", "barcode.remove": "Removed a barcode",
  "bill.post": "Received stock / supplier invoice", "supplier.pay": "Paid a supplier", "supplier.create": "Added a supplier",
  "stock.adjust": "Adjusted stock", "stocktake.start": "Started a stock take", "stocktake.submit": "Submitted a stock take", "stocktake.approve": "Approved a stock take", "stocktake.cancel": "Cancelled a stock take",
  "shift.open": "Opened the till", "shift.close": "Closed the till", "cash.movement": "Cash in/out of the drawer",
  "sale.refund": "Refunded a sale", "sale.exchange": "Exchanged items", "exchange.payout": "Paid out exchange credit",
  "customer.create": "Added a customer", "customer.payment": "Took a payment on account", "customer.credit_terms": "Changed credit terms",
  "offer.create": "Created an offer", "offer.pause": "Paused an offer", "offer.resume": "Resumed an offer",
  "expense.create": "Recorded an expense", "transfer.create": "Moved money", "journal.post": "Posted a manual journal",
  "tot.accrue": "Recorded Turnover Tax", "tot.pay": "Paid Turnover Tax", "mpesa.import": "Imported an M-Pesa statement", "books.lock": "Closed / reopened the books",
  "settings.update": "Changed shop settings", "team.add": "Added a staff login", "team.update": "Changed a staff login", "member.set_pin": "Set their PIN",
  "till.switch_user": "Switched in at the till", "opening.add": "Entered an opening balance",
};

const AREAS: { key: string; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "price", label: "Prices" },
  { key: "sale", label: "Refunds & exchanges" },
  { key: "cash", label: "Cash" },
  { key: "stock", label: "Stock" },
  { key: "team", label: "Team" },
];

function summarize(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  const keys = ["name", "totalCents", "amountCents", "amount", "reason", "code", "invoice", "role", "active", "qtyDelta", "retail", "wholesale", "field", "from", "to", "lockDate", "kind"];
  return keys
    .filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "")
    .map((k) => {
      const val = o[k];
      const shown = /Cents$/.test(k) || k === "retail" || k === "wholesale" ? `KES ${(Number(val) / 100).toLocaleString("en-KE")}` : String(val);
      return `${k.replace(/Cents$/, "")}: ${shown}`;
    })
    .slice(0, 4)
    .join(" · ");
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ who?: string; area?: string; from?: string; to?: string }> }) {
  const s = await requirePage("settings.edit");
  const sp = await searchParams;
  const today = nairobiDate();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : new Date(Date.parse(today) - 13 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const conds = [eq(auditLog.orgId, s.org.id), gte(auditLog.createdAt, new Date(`${from}T00:00:00+03:00`)), lte(auditLog.createdAt, new Date(`${to}T23:59:59+03:00`))];
  if (sp.who) conds.push(eq(auditLog.memberId, Number(sp.who)));
  if (sp.area) conds.push(like(auditLog.action, sp.area === "stock" ? "stock%" : `${sp.area}%`));
  const [rows, staff] = await Promise.all([
    db.select({ a: auditLog, who: members.name, email: members.email }).from(auditLog).leftJoin(members, eq(members.id, auditLog.memberId)).where(and(...conds)).orderBy(desc(auditLog.createdAt)).limit(300),
    db.select({ id: members.id, name: members.name, email: members.email }).from(members).where(eq(members.orgId, s.org.id)),
  ]);
  return (
    <>
      <PageHeader title="Activity log" subtitle="Every sensitive change, who made it and when. Entries can't be edited or deleted." />
      <form className="flex flex-wrap items-end gap-2 mb-5">
        <label className="grid gap-1 text-[12px] text-ink-400">Who
          <select name="who" defaultValue={sp.who ?? ""} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200">
            <option value="">Everyone</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-400">What
          <select name="area" defaultValue={sp.area ?? ""} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200">
            {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-400">From<input type="date" name="from" defaultValue={from} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200" /></label>
        <label className="grid gap-1 text-[12px] text-ink-400">To<input type="date" name="to" defaultValue={to} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200" /></label>
        <button className="h-9 px-4 rounded-md bg-brand text-brand-ink text-[13px] font-medium cursor-pointer">Show</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]"><tbody>
          {rows.length === 0 && <tr><td className="px-4 py-8 text-center text-ink-400">Nothing in this period.</td></tr>}
          {rows.map(({ a, who, email }) => (
            <tr key={a.id} className="hairline-t align-top">
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-600 tnum">{a.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "short", timeStyle: "short" })}</td>
              <td className="px-4 py-2.5 whitespace-nowrap font-medium">{who || email || "System"}</td>
              <td className="px-4 py-2.5">
                {LABELS[a.action] ?? a.action}
                {a.entityId && <span className="text-ink-400"> · {a.entity} #{a.entityId}</span>}
                {a.after || a.before ? <div className="text-[12px] text-ink-400">{summarize(a.after ?? a.before)}</div> : null}
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}
