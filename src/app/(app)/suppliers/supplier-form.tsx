"use client";

import { useActionState, useEffect, useRef } from "react";
import { createSupplier } from "./actions";
import { Button, Field, Input } from "@/components/ui";

export function SupplierForm() {
  const [state, action, pending] = useActionState(createSupplier, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="card p-5 grid gap-3">
      <h2 className="text-[13.5px] font-semibold">Add supplier</h2>
      <Field label="Name"><Input id="s-name" name="name" placeholder="Tolaram East Africa" required /></Field>
      <Field label="Phone"><Input id="s-phone" name="phone" inputMode="tel" /></Field>
      <Field label="Email"><Input id="s-email" name="email" type="email" /></Field>
      <Field label="KRA PIN"><Input id="s-pin" name="kraPin" /></Field>
      <Field label="How to pay them" hint="Paybill, account no., bank"><Input id="s-pay" name="paymentDetails" placeholder="Paybill 600100 · Acc 0100008849848" /></Field>
      <Field label="Credit terms (days)" hint="0 = pay on delivery" error={state.error}><Input id="s-terms" name="termsDays" inputMode="numeric" defaultValue="0" /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add supplier"}</Button>
    </form>
  );
}
