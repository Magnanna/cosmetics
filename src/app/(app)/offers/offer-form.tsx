"use client";

import { useState, useTransition } from "react";
import { createOffer } from "./actions";
import { parseKES } from "@/lib/money";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

type Type = "percent_off" | "amount_off" | "fixed_price" | "bonus_points" | "points_multiplier";
type TargetKind = "all" | "brand" | "category" | "product";

const TYPES: { key: Type; label: string; valueLabel: string; hint: string }[] = [
  { key: "percent_off", label: "% off", valueLabel: "Percent off", hint: "e.g. 20" },
  { key: "amount_off", label: "KES off each", valueLabel: "KES off each item", hint: "e.g. 100" },
  { key: "fixed_price", label: "Special price", valueLabel: "New price (KES)", hint: "e.g. 99" },
  { key: "bonus_points", label: "Bonus points", valueLabel: "Bonus points", hint: "e.g. 1000" },
  { key: "points_multiplier", label: "Points multiplier", valueLabel: "Multiply points by", hint: "e.g. 2" },
];

function localInput(d: Date) {
  const n = new Date(d.getTime() + 3 * 3_600_000); // Nairobi
  return n.toISOString().slice(0, 16);
}

export function OfferForm({ brands, categories, products }: { brands: { id: number; name: string }[]; categories: { id: number; name: string }[]; products: { id: number; name: string }[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Type>("percent_off");
  const [value, setValue] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [audience, setAudience] = useState<"all" | "retail" | "wholesale">("all");
  const [startsAt, setStartsAt] = useState(localInput(new Date()));
  const [endsAt, setEndsAt] = useState(localInput(new Date(Date.now() + 3 * 86_400_000)));
  const [targetKind, setTargetKind] = useState<TargetKind>("brand");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const t = TYPES.find((x) => x.key === type)!;
  const options = targetKind === "brand" ? brands : targetKind === "category" ? categories : targetKind === "product" ? products : [];
  const shown = options.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);

  function submit() {
    setError(null);
    setSaved(false);
    const n = Number(value);
    let v: number;
    if (type === "percent_off") v = Math.round(n * 100);
    else if (type === "amount_off" || type === "fixed_price") v = parseKES(value);
    else if (type === "bonus_points") v = Math.round(n * 100);
    else v = Math.round(n * 100);
    if (!Number.isFinite(v) || v <= 0) return setError(`Enter the ${t.valueLabel.toLowerCase()}.`);
    const min = minSpend.trim() ? parseKES(minSpend) : 0;
    if (Number.isNaN(min)) return setError("Minimum spend isn't a valid amount.");
    start(async () => {
      const r = await createOffer({ title, description: description.trim() || null, type, value: v, minSpendCents: min, audience, startsAt, endsAt, targetKind, targetIds: [...picked] });
      if (!r.ok) return setError(r.error);
      setSaved(true);
      setTitle(""); setDescription(""); setValue(""); setMinSpend(""); setPicked(new Set());
    });
  }

  return (
    <div className="card p-5 grid gap-3">
      <h2 className="text-[13.5px] font-semibold">New offer</h2>
      <Field label="Name customers see" hint="Shows on the till and receipt"><Input id="o-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend Lips 20% off" /></Field>
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((x) => (
          <button key={x.key} onClick={() => { setType(x.key); if (x.key === "fixed_price") setTargetKind("product"); }} className={`h-8 px-3 rounded-full text-[12.5px] cursor-pointer border ${type === x.key ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200"}`}>{x.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.valueLabel} hint={t.hint}><Input id="o-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        {type === "bonus_points" ? (
          <Field label="When they spend (KES)" hint="On the items below"><Input id="o-min" inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="1000" /></Field>
        ) : (
          <Field label="Who gets it">
            <Select id="o-aud" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
              <option value="all">Everyone</option>
              <option value="retail">Retail customers</option>
              <option value="wholesale">Salons / wholesale</option>
            </Select>
          </Field>
        )}
        <Field label="Starts"><Input id="o-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
        <Field label="Ends"><Input id="o-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
      </div>
      <Field label="Applies to">
        <Select id="o-kind" value={targetKind} onChange={(e) => { setTargetKind(e.target.value as TargetKind); setPicked(new Set()); }}>
          {type !== "fixed_price" && <option value="all">Everything in the shop</option>}
          {type !== "fixed_price" && <option value="brand">Brands</option>}
          {type !== "fixed_price" && <option value="category">Categories</option>}
          <option value="product">Specific products</option>
        </Select>
      </Field>
      {targetKind !== "all" && (
        <div className="grid gap-1.5">
          <Input aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${targetKind === "category" ? "categories" : `${targetKind}s`}`} />
          <div className="max-h-48 overflow-y-auto grid gap-0.5">
            {shown.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px] px-1 py-1 rounded hover:bg-ink-50">
                <input type="checkbox" checked={picked.has(o.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                {o.name}
              </label>
            ))}
            {shown.length === 0 && <span className="text-[12.5px] text-ink-400 px-1">Nothing to pick yet.</span>}
          </div>
          {picked.size > 0 && <span className="text-[12px] text-ink-400">{picked.size} selected</span>}
        </div>
      )}
      <Field label="Note (optional)"><Textarea id="o-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      {error && <p role="alert" className="text-bad text-[13px]">{error}</p>}
      {saved && <p className="text-good text-[13px]">Offer saved.</p>}
      <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Schedule offer"}</Button>
    </div>
  );
}
