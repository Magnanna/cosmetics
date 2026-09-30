import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, members, shifts } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { shiftSummary, type ShiftSummary } from "@/lib/cashup";
import { Card, Money, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const TENDER: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", credit: "On account", points: "Points", exchange: "Exchange credit" };

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("reports.view");
  const id = Number((await params).id);
  const [row] = await db.select({ sh: shifts, opener: members.name }).from(shifts).leftJoin(members, eq(members.id, shifts.openedBy)).where(and(eq(shifts.orgId, s.org.id), eq(shifts.id, id))).limit(1);
  if (!row) notFound();
  const { sh } = row;
  const z = (sh.zReport as (ShiftSummary & { counts: Record<string, number>; countedCents: number }) | null) ?? (await inOrg(s, () => shiftSummary(db, sh.id)));
  const line = (label: string, cents: number) => <div className="flex justify-between"><span className="text-ink-600">{label}</span><Money cents={cents} /></div>;
  return (
    <>
      <PageHeader title={sh.status === "open" ? "Shift in progress" : "Z-report"} subtitle={`${sh.openedAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "full", timeStyle: "short" })} · opened by ${row.opener || "staff"}`} />
      <div className="grid gap-5 md:grid-cols-2 items-start max-w-4xl">
        <Card className="p-5 grid gap-2 text-[13.5px]">
          <h2 className="text-[13.5px] font-semibold">Sales</h2>
          <div className="flex justify-between"><span className="text-ink-600">Receipts</span><span className="tnum">{z.saleCount}</span></div>
          {line("Total sold", z.salesCents)}
          {Object.entries(z.byTender).map(([m, c]) => <div key={m}>{line(`  ${TENDER[m] ?? m}`, c)}</div>)}
          {line("Discounts & offers", z.discountsCents)}
          {z.refunds.count > 0 && <div className="flex justify-between"><span className="text-ink-600">Returns</span><span className="tnum">{z.refunds.count}</span></div>}
          {Object.entries(z.refunds.byMethod).map(([m, c]) => <div key={m}>{line(`  Refunded ${TENDER[m] ?? m}`, -c)}</div>)}
          {Object.entries(z.creditPaymentsCents).map(([m, c]) => <div key={m}>{line(`Paid on account (${TENDER[m] ?? m})`, c)}</div>)}
        </Card>
        <Card className="p-5 grid gap-2 text-[13.5px]">
          <h2 className="text-[13.5px] font-semibold">Cash drawer</h2>
          {line("Opening float", z.openingFloatCents)}
          {z.movements.map((m, i) => <div key={i}>{line(`Cash ${m.amountCents > 0 ? "in" : "out"}: ${m.note ?? m.reason.replaceAll("_", " ")}`, m.amountCents)}</div>)}
          <div className="hairline-t pt-2">{line("Expected in drawer", sh.expectedCashCents ?? z.expectedCashCents)}</div>
          {sh.countedCashCents !== null && line("Counted", sh.countedCashCents)}
          {sh.varianceCents !== null && (
            <div className="flex justify-between items-center font-semibold">
              <span>Difference</span>
              {sh.varianceCents === 0 ? <Pill tone="good">Balanced</Pill> : <Money cents={sh.varianceCents} className={sh.varianceCents < 0 ? "text-bad" : "text-warn"} />}
            </div>
          )}
          {"counts" in z && z.counts ? (
            <div className="text-[12px] text-ink-400 pt-1">
              {Object.entries(z.counts as Record<string, number>).filter(([, n]) => Number(n) > 0).map(([d, n]) => `${n} × ${(Number(d) / 100).toLocaleString("en-KE")}`).join(" · ")}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
