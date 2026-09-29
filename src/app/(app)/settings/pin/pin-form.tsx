"use client";

import { useActionState } from "react";
import { setMyPin } from "./actions";
import { Button, Field, Input } from "@/components/ui";

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState(setMyPin, {});
  return (
    <form action={action} className="card p-5 grid gap-3">
      <p className="text-[13px] text-ink-600">{hasPin ? "You have a PIN. Set a new one to replace it." : "You haven't set a PIN yet."}</p>
      <Field label="New PIN" hint="4 to 6 digits, not 1234 or 0000"><Input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required /></Field>
      <Field label="Type it again" error={state.error}><Input id="confirm" name="confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save PIN"}</Button>
      {state.ok && <p className="text-good text-[13px]">PIN saved.</p>}
    </form>
  );
}
