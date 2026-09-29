"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { addExpense, addTransfer, postJournal, uploadMpesaStatement } from "./actions";
import { parseKES } from "@/lib/money";
import { Button, Field, Input, Select } from "@/components/ui";

const PLACES = [
  { value: "cash_at_hand", label: "Cash at hand" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank", label: "Bank" },
];

function Result({ state }: { state: { error?: string; ok?: string } }) {
  return <>{state.error && <p className="text-bad text-[13px]">{state.error}</p>}{state.ok && <p className="text-good text-[13px]">{state.ok}</p>}</>;
}

export function ExpenseForm({ accounts, today }: { accounts: { id: number; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState(addExpense, {});
  return (
    <form action={action} className="card p-5 grid gap-3" key={state.ok}>
      <h2 className="text-[15px] font-semibold">Record an expense</h2>
      <Field label="What for"><Input id="e-desc" name="description" placeholder="September rent" required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (KES)"><Input id="e-amt" name="amount" inputMode="decimal" required /></Field>
        <Field label="Date"><Input id="e-date" name="date" type="date" defaultValue={today} /></Field>
      </div>
      <Field label="Category"><Select id="e-acct" name="accountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid from"><Select id="e-from" name="paidFrom" defaultValue="mpesa">{PLACES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="Reference"><Input id="e-ref" name="reference" placeholder="M-Pesa code" /></Field>
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save expense"}</Button>
    </form>
  );
}

export function TransferForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addTransfer, {});
  return (
    <form action={action} className="card p-5 grid gap-3" key={state.ok}>
      <h2 className="text-[15px] font-semibold">Move money</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><Select id="t-from" name="from" defaultValue="cash_at_hand">{PLACES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="To"><Select id="t-to" name="to" defaultValue="bank">{PLACES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="Amount (KES)"><Input id="t-amt" name="amount" inputMode="decimal" required /></Field>
        <Field label="Fee charged (KES)" hint="e.g. M-Pesa withdrawal fee"><Input id="t-fee" name="fee" inputMode="decimal" /></Field>
        <Field label="Date"><Input id="t-date" name="date" type="date" defaultValue={today} /></Field>
        <Field label="Note"><Input id="t-note" name="note" placeholder="Banked Monday's cash" /></Field>
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save transfer"}</Button>
    </form>
  );
}

interface Line { key: number; accountId: string; debit: string; credit: string }
let k = 1;

export function JournalForm({ accounts, today }: { accounts: { id: number; code: string; name: string }[]; today: string }) {
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: k++, accountId: "", debit: "", credit: "" }, { key: k++, accountId: "", debit: "", credit: "" }]);
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const totals = useMemo(() => {
    const c = (v: string) => (v.trim() ? parseKES(v) : 0);
    return { dr: lines.reduce((s, l) => s + (c(l.debit) || 0), 0), cr: lines.reduce((s, l) => s + (c(l.credit) || 0), 0) };
  }, [lines]);
  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="card p-5 grid gap-3">
      <div className="grid sm:grid-cols-[160px_1fr] gap-3">
        <Field label="Date"><Input id="j-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="What is this for"><Input id="j-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Owner added capital to the bank" /></Field>
      </div>
      <table className="w-full text-[13.5px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="py-2 font-semibold">Account</th><th className="py-2 font-semibold text-right w-32">Debit</th><th className="py-2 font-semibold text-right w-32">Credit</th><th className="w-8" /></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td className="py-1 pr-2"><Select aria-label="Account" value={l.accountId} onChange={(e) => upd(l.key, { accountId: e.target.value })}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></td>
              <td className="py-1 px-1"><Input aria-label="Debit" inputMode="decimal" className="text-right" value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
              <td className="py-1 px-1"><Input aria-label="Credit" inputMode="decimal" className="text-right" value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
              <td>{lines.length > 2 && <button aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-ink-400 hover:text-bad cursor-pointer">✕</button>}</td>
            </tr>
          ))}
          <tr className="hairline-t font-semibold"><td className="py-2">Total</td><td className="py-2 text-right tnum">{(totals.dr / 100).toFixed(2)}</td><td className="py-2 text-right tnum">{(totals.cr / 100).toFixed(2)}</td><td /></tr>
        </tbody>
      </table>
      <div className="flex justify-between items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { key: k++, accountId: "", debit: "", credit: "" }])}>+ Line</Button>
        <span className={`text-[13px] ${totals.dr === totals.cr && totals.dr > 0 ? "text-good" : "text-warn"}`}>{totals.dr === totals.cr && totals.dr > 0 ? "Balanced" : `Difference ${((totals.dr - totals.cr) / 100).toFixed(2)}`}</span>
      </div>
      {state.error && <p className="text-bad text-[13px]">{state.error}</p>}
      {state.ok && <p className="text-good text-[13px]">{state.ok}</p>}
      <Button
        disabled={pending || totals.dr !== totals.cr || totals.dr === 0}
        onClick={() => start(async () => {
          const r = await postJournal({ date, memo, lines: lines.filter((l) => l.accountId && (l.debit || l.credit)).map((l) => ({ accountId: Number(l.accountId), debitCents: l.debit ? parseKES(l.debit) : 0, creditCents: l.credit ? parseKES(l.credit) : 0 })) });
          setState(r);
          if (r.ok) { setMemo(""); setLines([{ key: k++, accountId: "", debit: "", credit: "" }, { key: k++, accountId: "", debit: "", credit: "" }]); }
        })}
      >
        {pending ? "Posting…" : "Post journal"}
      </Button>
    </div>
  );
}

export function MpesaUpload() {
  const [state, action, pending] = useActionState(uploadMpesaStatement, {});
  return (
    <form action={action} className="card p-5 grid gap-3">
      <h2 className="text-[15px] font-semibold">Import a statement</h2>
      <p className="text-[13px] text-ink-600">M-Pesa portal (org.ke.m-pesa.com) → Statement → choose dates → export as CSV. Importing the same lines twice is safe.</p>
      <input type="file" name="file" accept=".csv,text/csv" required className="text-[13px]" />
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Importing…" : "Import and match"}</Button>
    </form>
  );
}
