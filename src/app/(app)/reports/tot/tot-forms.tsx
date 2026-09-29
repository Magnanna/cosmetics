"use client";

import { useActionState, useState, useTransition } from "react";
import { payTot, recordTot } from "../../money/actions";

export function RecordTotButton({ month }: { month: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="grid gap-1 justify-items-end">
      <button disabled={pending} onClick={() => start(async () => { const r = await recordTot(month); setMsg(r.error ?? null); })} className="h-8 px-3 rounded-md bg-brand text-brand-ink text-[12.5px] font-medium cursor-pointer">
        {pending ? "Saving…" : "Record tax owed"}
      </button>
      {msg && <span className="text-[12px] text-bad">{msg}</span>}
    </span>
  );
}

export function PayTotForm({ month, owedCents, today }: { month: string; owedCents: number; today: string }) {
  const [state, action, pending] = useActionState(payTot, {});
  return (
    <form action={action} className="flex flex-wrap gap-1.5 justify-end items-center">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="date" value={today} />
      <input name="amount" defaultValue={(owedCents / 100).toFixed(2)} inputMode="decimal" aria-label="Amount" className="h-8 w-24 rounded-md border-[0.5px] border-ink-200 px-2 text-right tnum text-[12.5px]" />
      <select name="paidFrom" defaultValue="mpesa" aria-label="Paid from" className="h-8 rounded-md border-[0.5px] border-ink-200 px-1 text-[12.5px]">
        <option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cash_at_hand">Cash</option>
      </select>
      <input name="reference" placeholder="PRN / ref" aria-label="Reference" className="h-8 w-24 rounded-md border-[0.5px] border-ink-200 px-2 text-[12.5px]" />
      <button disabled={pending} className="h-8 px-3 rounded-md bg-brand text-brand-ink text-[12.5px] font-medium cursor-pointer">{pending ? "…" : "Record payment"}</button>
      {state.error && <span className="w-full text-right text-[12px] text-bad">{state.error}</span>}
    </form>
  );
}
