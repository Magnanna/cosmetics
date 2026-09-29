"use client";

import { useActionState, useEffect, useState } from "react";
import { adjustStock } from "../actions";
import type { PickVariant } from "@/lib/picklist";
import { VariantSearch } from "@/components/variant-search";
import { Button, Field, Input, Select } from "@/components/ui";

const OUT = [
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost or stolen" },
  { value: "owner_use", label: "Owner took for personal use" },
  { value: "other", label: "Other (explain)" },
];
const IN = [
  { value: "found", label: "Found" },
  { value: "other", label: "Other (explain)" },
];

export function AdjustForm({ variants }: { variants: PickVariant[] }) {
  const [state, action, pending] = useActionState(adjustStock, {});
  const [picked, setPicked] = useState<PickVariant | null>(null);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [unknown, setUnknown] = useState<string | null>(null);
  const reasons = direction === "out" ? OUT : IN;

  useEffect(() => {
    if (state.ok) setPicked(null);
  }, [state]);

  return (
    <form action={action} className="card p-5 grid gap-3">
      <h2 className="text-[15px] font-semibold">New adjustment</h2>
      {picked ? (
        <div className="rounded-lg bg-ink-50 px-3 py-2.5 flex justify-between gap-3 text-[13.5px]">
          <span><span className="font-medium">{picked.label}</span><span className="text-ink-400"> · {picked.onHand} in stock</span></span>
          <button type="button" className="text-ink-600 hover:text-ink-900 cursor-pointer" onClick={() => setPicked(null)}>Change</button>
          <input type="hidden" name="variantId" value={picked.id} />
        </div>
      ) : (
        <VariantSearch variants={variants} showStock onPick={(v) => { setPicked(v); setUnknown(null); }} onUnknownBarcode={setUnknown} />
      )}
      {unknown && <p className="text-[12.5px] text-bad">Barcode {unknown} isn't on any product.</p>}
      <div className="grid grid-cols-2 gap-2">
        {(["out", "in"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDirection(d)} className={`h-10 rounded-lg text-[13.5px] font-medium cursor-pointer border-[0.5px] ${direction === d ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200 hover:bg-ink-50"}`}>
            {d === "out" ? "Remove stock" : "Add stock"}
          </button>
        ))}
      </div>
      <input type="hidden" name="direction" value={direction} />
      <Field label="How many units"><Input id="adj-qty" name="qty" inputMode="numeric" required /></Field>
      <Field label="Reason">
        <Select id="adj-reason" name="reason" key={direction} defaultValue={reasons[0].value}>
          {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
      </Field>
      <Field label="Note" error={state.error}><Input id="adj-note" name="note" placeholder="e.g. bottle cracked on the shelf" /></Field>
      <Button type="submit" disabled={pending || !picked}>{pending ? "Saving…" : "Save adjustment"}</Button>
      {state.ok && <p className="text-good text-[13px]">{state.ok}</p>}
    </form>
  );
}
