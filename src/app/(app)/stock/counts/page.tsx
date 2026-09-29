import Link from "next/link";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, brands, categories, members, stockTakeLines, stockTakes } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Money, PageHeader, Pill } from "@/components/ui";
import { StartCount } from "./start-count";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "brand" | "warn" | "good" | "neutral" }> = {
  counting: { label: "Counting", tone: "brand" },
  submitted: { label: "Waiting for owner", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function CountsPage() {
  const s = await requirePage("stock.count");
  const [takes, cats, brandRows] = await Promise.all([
    db
      .select({
        t: stockTakes,
        who: members.name,
        total: sql<number>`(select count(*)::int from ${stockTakeLines} where ${stockTakeLines.stockTakeId} = ${stockTakes.id})`,
        counted: sql<number>`(select count(*)::int from ${stockTakeLines} where ${stockTakeLines.stockTakeId} = ${stockTakes.id} and ${stockTakeLines.countedQty} is not null)`,
      })
      .from(stockTakes)
      .leftJoin(members, eq(members.id, stockTakes.startedBy))
      .where(eq(stockTakes.orgId, s.org.id))
      .orderBy(desc(stockTakes.createdAt))
      .limit(30),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(and(eq(categories.orgId, s.org.id), isNull(categories.parentId), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
    db.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.orgId, s.org.id), eq(brands.archived, false))).orderBy(asc(brands.name)),
  ]);
  const inProgress = takes.find((r) => r.t.status === "counting" || r.t.status === "submitted");

  return (
    <>
      <PageHeader title="Stock take" subtitle="Count what's on the shelves each week. The owner approves any differences." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="card overflow-x-auto">
          {takes.length === 0 ? (
            <p className="p-6 text-[13.5px] text-ink-400">No counts yet. Start one on the right.</p>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-3 font-semibold">Count</th>
                  <th className="px-4 py-3 font-semibold">Progress</th>
                  <th className="px-4 py-3 font-semibold text-right">Difference</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {takes.map(({ t, who, total, counted }) => (
                  <tr key={t.id} className="hairline-t">
                    <td className="px-4 py-3">
                      <Link href={`/stock/counts/${t.id}`} className="font-medium hover:underline">{t.scopeLabel}</Link>
                      <div className="text-[12px] text-ink-400">{who || "Staff"} · {t.createdAt.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })}</div>
                    </td>
                    <td className="px-4 py-3 tnum text-ink-600">{counted} of {total} counted</td>
                    <td className="px-4 py-3 text-right">{t.varianceCostCents === null ? "—" : <Money cents={t.varianceCostCents} className={t.varianceCostCents < 0 ? "text-bad" : ""} />}</td>
                    <td className="px-4 py-3 text-right"><Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {inProgress ? (
          <div className="card p-5 grid gap-2">
            <h2 className="text-[15px] font-semibold">Count in progress</h2>
            <p className="text-[13.5px] text-ink-600">{inProgress.t.scopeLabel} · {inProgress.counted} of {inProgress.total} counted.</p>
            <Link href={`/stock/counts/${inProgress.t.id}`} className="text-brand-700 underline text-[13.5px]">{inProgress.t.status === "submitted" && can(s.role, "stock.approve") ? "Review and approve" : "Continue"}</Link>
          </div>
        ) : (
          <StartCount categories={cats} brands={brandRows} />
        )}
      </div>
    </>
  );
}
