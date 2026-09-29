import { desc, eq } from "drizzle-orm";
import { db, smsLog } from "@/db";
import { requirePage } from "@/lib/auth";
import { smsConfigured } from "@/lib/sms";
import { EmptyState, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const s = await requirePage("settings.edit");
  const rows = await db.select().from(smsLog).where(eq(smsLog.orgId, s.org.id)).orderBy(desc(smsLog.createdAt)).limit(100);
  return (
    <>
      <PageHeader title="SMS messages" subtitle={smsConfigured() ? "Receipts and alerts sent through Africa's Talking." : "SMS isn't connected yet — messages are recorded here but not sent. Add Africa's Talking keys to switch it on."} />
      {rows.length === 0 ? <EmptyState title="No messages yet" body="Every sale sends the customer an SMS receipt with their points." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="hairline-t align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-ink-600 tnum">{m.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-4 py-3 whitespace-nowrap tnum">{m.to}</td>
                  <td className="px-4 py-3">{m.body}{m.error && <div className="text-[12px] text-bad">{m.error}</div>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap"><Pill tone={m.status === "sent" ? "good" : m.status === "failed" ? "bad" : "neutral"}>{m.status}</Pill>{m.costText && <div className="text-[11.5px] text-ink-400 mt-1">{m.costText}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
