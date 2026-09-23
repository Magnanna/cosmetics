import { and, asc, eq } from "drizzle-orm";
import { db, categories } from "@/db";
import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

export default async function CategoriesPage() {
  const s = await requirePage("catalog.edit");
  const rows = await db.select().from(categories).where(and(eq(categories.orgId, s.org.id), eq(categories.archived, false))).orderBy(asc(categories.sortOrder), asc(categories.name));
  const parents = rows.filter((r) => r.parentId === null);
  return (
    <>
      <PageHeader title="Categories" subtitle="How products are grouped on the till and in reports." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {parents.map((p) => {
          const kids = rows.filter((r) => r.parentId === p.id);
          return (
            <div key={p.id} className="card p-4 grid gap-2 content-start">
              <div className="font-semibold text-[14px]">{p.name}</div>
              {kids.length > 0 && <div className="flex flex-wrap gap-1.5">{kids.map((k) => <span key={k.id} className="text-[12px] px-2 py-0.5 rounded-full bg-ink-50 border-[0.5px] border-ink-100 text-ink-600">{k.name}</span>)}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
