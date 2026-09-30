"use client";

import { useActionState, useState } from "react";
import { recordPayment, saveCredit } from "../actions";
import { Button, Field, Input, Select } from "@/components/ui";

export function CreditForm({ customer }: { customer: { id: number; type: "retail" | "wholesale"; businessName: string | null; creditEnabled: boolean; creditLimitCents: number; creditTermsDays: number } }) {
  const [state, action, pending] = useActionState(saveCredit, {});
  const [enabled, setEnabled] = useState(customer.creditEnabled);
  return (
    <form action={action} className="card p-5 grid gap-3">
      <h2 className="text-[13.5px] font-semibold">Customer type & credit</h2>
      <input type="hidden" name="customerId" value={customer.id} />
      <Field label="Type" hint="Wholesale customers pay wholesale prices and don't earn points">
        <Select id="c-type" name="type" defaultValue={customer.type}>
          <option value="retail">Retail</option>
          <option value="wholesale">Salon / wholesale</option>
        </Select>
      </Field>
      <Field label="Business name (salons)"><Input id="c-biz" name="businessName" defaultValue={customer.businessName ?? ""} /></Field>
      <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="enabled" value="on" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Can buy on account</label>
      {enabled && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Credit limit (KES)"><Input id="c-limit" name="limit" inputMode="decimal" defaultValue={customer.creditLimitCents / 100 || ""} /></Field>
          <Field label="Days to pay"><Input id="c-days" name="termsDays" inputMode="numeric" defaultValue={customer.creditTermsDays} /></Field>
        </div>
      )}
      {!enabled && <><input type="hidden" name="limit" value={customer.creditLimitCents / 100} /><input type="hidden" name="termsDays" value={customer.creditTermsDays} /></>}
      {state.error && <p className="text-bad text-[13px]">{state.error}</p>}
      {state.ok && <p className="text-good text-[13px]">Saved.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function PaymentForm({ customerId, owedCents }: { customerId: number; owedCents: number }) {
  const [state, action, pending] = useActionState(recordPayment, {});
  const [method, setMethod] = useState<"mpesa" | "bank" | "cash">("mpesa");
  return (
    <form action={action} className="card p-5 grid gap-3">
      <h2 className="text-[13.5px] font-semibold">Record a payment</h2>
      <input type="hidden" name="customerId" value={customerId} />
      <Field label="Amount (KES)" hint={`Owes ${(owedCents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`}><Input id="p-amt" name="amount" inputMode="decimal" required /></Field>
      <Field label="Paid by">
        <Select id="p-method" name="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="mpesa">M-Pesa</option>
          <option value="bank">Bank</option>
          <option value="cash">Cash (not at the till)</option>
        </Select>
      </Field>
      {method === "mpesa" ? <Field label="M-Pesa code"><Input id="p-code" name="mpesaCode" className="uppercase" /></Field> : <Field label="Reference"><Input id="p-ref" name="reference" /></Field>}
      {state.error && <p className="text-bad text-[13px]">{state.error}</p>}
      {state.ok && <p className="text-good text-[13px]">Payment recorded.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
    </form>
  );
}
