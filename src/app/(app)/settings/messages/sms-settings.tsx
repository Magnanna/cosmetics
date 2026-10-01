"use client";

import { useState, useTransition } from "react";
import { saveSmsSettings, sendTestSms } from "./actions";
import { Button, Field, Input } from "@/components/ui";

export function SmsSettingsCard({ enabled, senderId, hasKeys }: { enabled: boolean; senderId: string; hasKeys: boolean }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [test, setTest] = useState<{ ok?: string; error?: string }>({});
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  return (
    <section className="card p-5 grid gap-4 max-w-2xl mb-5">
      <div>
        <h2 className="text-[13.5px] font-semibold">SMS provider · Advanta</h2>
        <p className="text-[12.5px] text-ink-400 mt-0.5">
          Receipts, points, credit reminders and the owner's daily summary are sent from your own Advanta account. Get the keys from the Advanta portal.
          {hasKeys && " Keys are saved (encrypted) — leave them blank to keep them."}
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await saveSmsSettings(fd);
            setMsg(r);
            if (r.ok) (e.target as HTMLFormElement).querySelectorAll<HTMLInputElement>("input[type=password]").forEach((i) => (i.value = ""));
          });
        }}
      >
        <label className="flex items-center gap-2.5 text-[13px] font-medium cursor-pointer">
          <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4 accent-[var(--color-brand)]" />
          Send SMS through Advanta
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sender ID" hint="Registered with Advanta, e.g. KENFRI"><Input name="senderId" defaultValue={senderId} maxLength={11} placeholder="KENFRI" /></Field>
          <Field label="Partner ID"><Input name="partnerId" type="password" autoComplete="off" placeholder={hasKeys ? "Saved" : "From Advanta"} /></Field>
          <Field label="API key"><Input name="apiKey" type="password" autoComplete="off" placeholder={hasKeys ? "Saved" : "From Advanta"} /></Field>
        </div>
        {msg.error && <p className="text-bad text-[13px]">{msg.error}</p>}
        {msg.ok && <p className="text-good text-[13px]">{msg.ok}</p>}
        <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save SMS settings"}</Button></div>
      </form>
      <div className="hairline-t pt-4 grid gap-2">
        <span className="text-[12px] font-medium text-ink-600">Send a test SMS</span>
        <div className="flex gap-2 max-w-sm">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" />
          <Button type="button" variant="secondary" disabled={testing} onClick={() => startTest(async () => setTest(await sendTestSms(phone)))}>{testing ? "Sending…" : "Send test"}</Button>
        </div>
        {test.error && <p className="text-bad text-[13px]">{test.error}</p>}
        {test.ok && <p className="text-good text-[13px]">{test.ok}</p>}
      </div>
    </section>
  );
}
