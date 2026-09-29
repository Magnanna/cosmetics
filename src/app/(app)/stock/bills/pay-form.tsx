"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { paySupplier } from "../actions";
import { Button, Field, Input, Select } from "@/components/ui";

export function PayForm({ suppliers }: { suppliers: { id: number; name: string; owedCents: number }[] }) {
  const [state, action, pending] = useActionState(paySupplier, {});
  const [supplierId, setSupplierId] = useState(suppliers[0].id);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);
  const owed = suppliers.find((s) => s.id === supplierId)?.owedCents ?? 0;
  return (
    <form ref={formRef} action={action} className="card p-5 grid gap-3">
      <h2 className="text-[15px] font-semibold">Pay a supplier</h2>
      <Field label="Supplier">
        <Select id="p-supplier" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Amount (KES)" hint={`Owed: ${(owed / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })} — oldest invoices are paid first`}>
        <Input id="p-amount" name="amount" inputMode="decimal" required />
      </Field>
      <Field label="Paid from">
        <Select id="p-method" name="method" defaultValue="mpesa">
          <option value="mpesa">M-Pesa</option>
          <option value="bank">Bank</option>
          <option value="cash">Cash at hand</option>
        </Select>
      </Field>
      <Field label="Reference" hint="M-Pesa code or cheque number" error={state.error}><Input id="p-ref" name="reference" /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
      {state.ok && <p className="text-good text-[13px]">Payment recorded.</p>}
    </form>
  );
}
