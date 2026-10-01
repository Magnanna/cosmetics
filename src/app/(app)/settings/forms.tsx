"use client";

import { useActionState, useState, useTransition } from "react";
import { addOpening, addStaffMember, changeStaff, saveShop } from "./actions";
import { setLockDate } from "../money/actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { Role } from "@/lib/context";

function Result({ state }: { state: { error?: string; ok?: string } }) {
  return <>{state.error && <p className="text-bad text-[13px]">{state.error}</p>}{state.ok && <p className="text-good text-[13px]">{state.ok}</p>}</>;
}

export interface ShopValues {
  name: string; phone: string; address: string; kraPin: string; receiptFooter: string;
  cashierDiscountLimit: number; returnWindowHours: number; reorderCoverDays: number; loyaltyEarnKes: number; loyaltyPointValue: number; loyaltyMinRedeem: number; totRatePct: number;
}

export function ShopForm({ v }: { v: ShopValues }) {
  const [state, action, pending] = useActionState(saveShop, {});
  return (
    <form action={action} className="grid gap-5 max-w-2xl">
      <div className="card p-5 grid gap-3 sm:grid-cols-2">
        <h2 className="text-[13.5px] font-semibold sm:col-span-2">Shop</h2>
        <Field label="Shop name"><Input id="s-name" name="name" defaultValue={v.name} required /></Field>
        <Field label="Owner's phone" hint="Gets the daily summary SMS"><Input id="s-phone" name="phone" defaultValue={v.phone} inputMode="tel" /></Field>
        <Field label="Address (on receipts)"><Input id="s-addr" name="address" defaultValue={v.address} /></Field>
        <Field label="KRA PIN (on receipts)"><Input id="s-pin" name="kraPin" defaultValue={v.kraPin} /></Field>
        <div className="sm:col-span-2"><Field label="Receipt footer"><Textarea id="s-foot" name="receiptFooter" rows={2} defaultValue={v.receiptFooter} /></Field></div>
      </div>
      <div className="card p-5 grid gap-3 sm:grid-cols-2">
        <h2 className="text-[13.5px] font-semibold sm:col-span-2">Till rules</h2>
        <Field label="Cashier discount limit (KES)" hint="Above this the owner enters their PIN"><Input id="s-disc" name="cashierDiscountLimit" inputMode="decimal" defaultValue={v.cashierDiscountLimit} /></Field>
        <Field label="Return window (hours)"><Input id="s-ret" name="returnWindowHours" inputMode="numeric" defaultValue={v.returnWindowHours} /></Field>
        <Field label="Days of stock after a delivery" hint="The reorder list orders enough to last this long"><Input id="s-cover" name="reorderCoverDays" inputMode="numeric" defaultValue={v.reorderCoverDays} /></Field>
      </div>
      <div className="card p-5 grid gap-3 sm:grid-cols-3">
        <h2 className="text-[13.5px] font-semibold sm:col-span-3">Loyalty points</h2>
        <Field label="KES spent per point"><Input id="s-earn" name="loyaltyEarnKes" inputMode="decimal" defaultValue={v.loyaltyEarnKes} /></Field>
        <Field label="Value of 1 point (KES)"><Input id="s-val" name="loyaltyPointValue" inputMode="decimal" defaultValue={v.loyaltyPointValue} /></Field>
        <Field label="Use points from (KES)"><Input id="s-min" name="loyaltyMinRedeem" inputMode="decimal" defaultValue={v.loyaltyMinRedeem} /></Field>
      </div>
      <div className="card p-5 grid gap-3 sm:grid-cols-2">
        <h2 className="text-[13.5px] font-semibold sm:col-span-2">Tax</h2>
        <Field label="Turnover Tax rate (%)" hint="1.5% since 2023 — confirm with your accountant"><Input id="s-tot" name="totRatePct" inputMode="decimal" defaultValue={v.totRatePct} /></Field>
      </div>
      <Result state={state} />
      <div><Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div>
    </form>
  );
}

export function AddStaffForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(addStaffMember, {});
  if (!enabled) {
    return (
      <div className="card p-5 grid gap-2">
        <h2 className="text-[13.5px] font-semibold">Add staff</h2>
        <p className="text-[13px] text-ink-600">To create staff logins, add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> (Supabase → Project Settings → API → service_role) and restart.</p>
      </div>
    );
  }
  return (
    <form action={action} className="card p-5 grid gap-3" key={state.ok}>
      <h2 className="text-[13.5px] font-semibold">Add staff</h2>
      <Field label="Name"><Input id="m-name" name="name" required /></Field>
      <Field label="Email (their login)"><Input id="m-email" name="email" type="email" required /></Field>
      <Field label="Starting password" hint="Tell them in person; they can change it later"><Input id="m-pw" name="password" type="text" autoComplete="off" minLength={10} required /></Field>
      <Field label="Role">
        <Select id="m-role" name="role" defaultValue="cashier">
          <option value="cashier">Cashier — sells, returns within the rules</option>
          <option value="staff">Staff — receives stock, counts, adds products</option>
          <option value="accountant">Accountant — books and reports, no till</option>
          <option value="owner">Owner — everything</option>
        </Select>
      </Field>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create login"}</Button>
    </form>
  );
}

export function StaffRow({ id, role, active, isMe }: { id: number; role: Role; active: boolean; isMe: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (patch: { role?: Role; active?: boolean }) => start(async () => { const r = await changeStaff(id, patch); setError(r.error ?? null); });
  return (
    <span className="flex items-center gap-2 justify-end flex-wrap">
      <select disabled={pending || isMe} value={role} onChange={(e) => act({ role: e.target.value as Role })} className="h-8 rounded-lg border border-ink-200 px-1 text-[13px]" aria-label="Role">
        <option value="cashier">Cashier</option><option value="staff">Staff</option><option value="accountant">Accountant</option><option value="owner">Owner</option>
      </select>
      {!isMe && <button disabled={pending} onClick={() => act({ active: !active })} className="text-[12.5px] underline text-ink-600 cursor-pointer">{active ? "Deactivate" : "Reactivate"}</button>}
      {error && <span className="text-bad text-[12px] w-full text-right">{error}</span>}
    </span>
  );
}

export function OpeningForm({ suppliers, customers, today }: { suppliers: { id: number; name: string }[]; customers: { id: number; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState(addOpening, {});
  const [kind, setKind] = useState<"money" | "supplier" | "customer">("money");
  return (
    <form action={action} className="card p-5 grid gap-3" key={state.ok}>
      <h2 className="text-[13.5px] font-semibold">Add an opening balance</h2>
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-3 gap-1.5">
        {([["money", "Money"], ["supplier", "We owe a supplier"], ["customer", "Customer owes us"]] as const).map(([k, l]) => (
          <button type="button" key={k} onClick={() => setKind(k)} className={`h-9 rounded-lg text-[12.5px] font-medium cursor-pointer border ${kind === k ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200"}`}>{l}</button>
        ))}
      </div>
      {kind === "money" && <Field label="Where"><Select id="o-acct" name="account"><option value="cash_at_hand">Cash at hand</option><option value="mpesa">M-Pesa till balance</option><option value="bank">Bank balance</option></Select></Field>}
      {kind === "supplier" && (
        <>
          <Field label="Supplier"><Select id="o-sup" name="supplierId">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Their invoice number"><Input id="o-ref" name="reference" /></Field>
        </>
      )}
      {kind === "customer" && <Field label="Customer" hint="Credit customers only; add them at the till first"><Select id="o-cust" name="customerId">{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (KES)"><Input id="o-amt" name="amount" inputMode="decimal" required /></Field>
        <Field label="As at"><Input id="o-date" name="date" type="date" defaultValue={today} /></Field>
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function LockForm({ lockDate }: { lockDate: string | null }) {
  const [state, action, pending] = useActionState(setLockDate, {});
  return (
    <form action={action} className="card p-5 grid gap-3 max-w-md">
      <p className="text-[13.5px] text-ink-600">{lockDate ? <>The books are closed up to <b>{lockDate}</b>. Nothing can be recorded on or before that date.</> : "The books are open — any date can be recorded."}</p>
      <Field label="Close the books up to" hint="Usually the last day of a month the accountant has finished. Leave empty to reopen."><Input id="lock" name="lockDate" type="date" defaultValue={lockDate ?? ""} /></Field>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
