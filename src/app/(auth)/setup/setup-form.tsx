"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createOwner } from "./actions";
import { Button, Card, Field, Input } from "@/components/ui";

export function SetupForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(createOwner, {});

  useEffect(() => {
    if (state.done) router.replace("/");
  }, [state.done, router]);

  if (state.confirmEmail) {
    return (
      <Card className="p-6 grid gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight">Check your email</h1>
        <p className="text-[14px] text-ink-600">We sent a confirmation link. Open it, then sign in.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={action} className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-[20px] font-semibold tracking-tight">Create the owner account</h1>
          <p className="text-[13px] text-ink-400">This page only works once. After this, add staff from Settings.</p>
        </div>
        <Field label="Your name"><Input id="name" name="name" required /></Field>
        <Field label="Email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" hint="At least 10 characters" error={state.error}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Button type="submit" disabled={pending} size="lg">{pending ? "Creating…" : "Create owner account"}</Button>
      </form>
    </Card>
  );
}
