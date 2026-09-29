import { asc, eq } from "drizzle-orm";
import { db, members } from "@/db";
import { requirePage } from "@/lib/auth";
import type { Role } from "@/lib/context";
import { staffLoginsEnabled } from "@/lib/team";
import { PageHeader, Pill } from "@/components/ui";
import { AddStaffForm, StaffRow } from "../forms";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const s = await requirePage("team.manage");
  const rows = await db.select().from(members).where(eq(members.orgId, s.org.id)).orderBy(asc(members.createdAt));
  return (
    <>
      <PageHeader title="Team" subtitle="Everyone who can sign in. Each person has their own login, so every sale and change shows who did it." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]"><tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`hairline-t ${m.active ? "" : "text-ink-400"}`}>
                <td className="px-4 py-3"><div className="font-medium">{m.name || m.email}{m.id === s.member.id && <span className="text-ink-400 font-normal"> (you)</span>}</div><div className="text-[12px] text-ink-400">{m.email}</div></td>
                <td className="px-4 py-3">{!m.active && <Pill>Deactivated</Pill>}{m.active && !m.pinHash && m.role === "owner" && <Pill tone="warn">No PIN yet</Pill>}</td>
                <td className="px-4 py-3"><StaffRow id={m.id} role={m.role as Role} active={m.active} isMe={m.id === s.member.id} /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <AddStaffForm enabled={staffLoginsEnabled()} />
      </div>
    </>
  );
}
