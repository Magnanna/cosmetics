import { desc, eq } from "drizzle-orm";
import { db, smsLog, smsSettings } from "@/db";
import { requirePage } from "@/lib/auth";
import { smsConfigured } from "@/lib/sms";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { SmsSettingsCard } from "./sms-settings";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const s = await requirePage("settings.edit");
  const [cfg] = await db.select().from(smsSettings).where(eq(smsSettings.orgId, s.org.id)).limit(1);
  const live = await smsConfigured(s.org.id);
  const rows = await db.select().from(smsLog).where(eq(smsLog.orgId, s.org.id)).orderBy(desc(smsLog.createdAt)).limit(100);
  return (
    <>
      <PageHeader title="SMS messages" subtitle={live ? `Receipts and alerts are sent through Advanta as ${cfg?.senderId}.` : "SMS isn't switched on yet — messages are recorded here but not sent."} />
      <SmsSettingsCard enabled={!!cfg?.enabled} senderId={cfg?.senderId ?? ""} hasKeys={!!cfg?.configEnc} />
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
