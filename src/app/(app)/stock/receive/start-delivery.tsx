"use client";

import { useActionState, useState } from "react";
import { newDelivery } from "./actions";
import { Button, Field, Input, Select } from "@/components/ui";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function StartDelivery({ suppliers, today }: { suppliers: { id: number; name: string; termsDays: number }[]; today: string }) {
  const [state, action, pending] = useActionState(newDelivery, {});
  const [supplierId, setSupplierId] = useState(suppliers[0].id);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const terms = suppliers.find((s) => s.id === supplierId)?.termsDays ?? 0;

  return (
    <form action={action} className="card p-5 grid gap-3">
      <h2 className="text-[15px] font-semibold">New delivery</h2>
      <Field label="Supplier">
        <Select id="d-supplier" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Invoice number"><Input id="d-inv" name="supplierInvoiceNo" placeholder="WBNSAL2025021188" required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoice date"><Input id="d-date" type="date" name="invoiceDate" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
        <Field label="Pay by"><Input id="d-due" type="date" name="dueDate" key={`${supplierId}-${invoiceDate}`} defaultValue={addDays(invoiceDate, terms)} /></Field>
      </div>
      <Field label="Rates on the invoice" error={state.error}>
        <Select id="d-vat" name="ratesIncludeVat" defaultValue="yes">
          <option value="yes">Already include VAT (lines add up to the total)</option>
          <option value="no">Exclude VAT (16% added at the bottom)</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Starting…" : "Start scanning"}</Button>
    </form>
  );
}
