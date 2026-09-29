import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, members, shifts } from "@/db";
import { requirePage } from "@/lib/auth";
import { EmptyState, Money, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const s = await requirePage("reports.view");
  const rows = await db
    .select({
      sh: shifts,
      opener: members.name,
      sales: sql<string>`(select coalesce(sum(s.total_cents),0) from sales s where s.shift_id = "shifts"."id")`,
      count: sql<number>`(select count(*)::int from sales s where s.shift_id = "shifts"."id")`,
    })
    .from(shifts)
    .leftJoin(members, eq(members.id, shifts.openedBy))
    .where(eq(shifts.orgId, s.org.id))
    .orderBy(desc(shifts.openedAt))
    .limit(60);
  const fmt = (d: Date | null) => (d ? d.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }) : "—");
  return (
    <>
      <PageHeader title="Shifts & cash-ups" subtitle="Every till shift, what was sold and whether the drawer balanced." />
      {rows.length === 0 ? <EmptyState title="No shifts yet" body="Shifts appear when someone opens the till." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-4 py-3 font-semibold">Shift</th>
                <th className="px-4 py-3 font-semibold text-right">Sales</th>
                <th className="px-4 py-3 font-semibold text-right">Counted</th>
                <th className="px-4 py-3 font-semibold text-right">Drawer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sh, opener, sales: total, count }) => {
                const v = sh.varianceCents;
                return (
                  <tr key={sh.id} className="hairline-t">
                    <td className="px-4 py-3">
                      <Link href={`/sales/shifts/${sh.id}`} className="font-medium hover:underline">{fmt(sh.openedAt)}</Link>
                      <div className="text-[12px] text-ink-400">{opener || "Staff"}{sh.closedAt ? ` · closed ${fmt(sh.closedAt)}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-right"><span className="text-ink-400 tnum mr-2">{count}</span><Money cents={Number(total)} /></td>
                    <td className="px-4 py-3 text-right">{sh.countedCashCents === null ? "—" : <Money cents={sh.countedCashCents} />}</td>
                    <td className="px-4 py-3 text-right">
                      {sh.status === "open" ? <Pill tone="brand">Open</Pill> : v === 0 ? <Pill tone="good">Balanced</Pill> : <Pill tone={v! < 0 ? "bad" : "warn"}>{v! < 0 ? "Short" : "Over"} {(Math.abs(v!) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
