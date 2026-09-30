"use client";

import { useState, useTransition } from "react";
import { barcodeAdd, barcodeRemove, newVariant, saveProduct, saveVariant, studioPhoto, undoStudio } from "../edit-actions";
import { parseKES } from "@/lib/money";
import { Button, Card, Field, Input, Pill, Select } from "@/components/ui";

export interface EditableVariant {
  id: number;
  option1Value: string | null;
  option2Value: string | null;
  retailCents: number;
  wholesaleCents: number;
  reorderLevel: number;
  swatchHex: string | null;
  archived: boolean;
  onHand: number;
  avgCostCents: number | null;
  barcodes: { id: number; code: string; source: string }[];
  pending: { field: string; newCents: number }[];
}

const kes = (c: number) => (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toInput = (c: number) => (c / 100).toFixed(2);

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  return m ? <p className={`text-[13px] ${m.ok ? "text-good" : "text-bad"}`}>{m.text}</p> : null;
}

export function ProductEditor({ product, variants, categories, isOwner, studioEnabled = false }: {
  product: { id: number; name: string; brandName: string | null; categoryId: number | null; option1Name: string | null; option2Name: string | null; archived: boolean; imageUrl: string | null; isStudio: boolean };
  variants: EditableVariant[];
  studioEnabled?: boolean;
  categories: { id: number; label: string }[];
  isOwner: boolean;
}) {
  const [name, setName] = useState(product.name);
  const [brand, setBrand] = useState(product.brandName ?? "");
  const [categoryId, setCategoryId] = useState(product.categoryId ? String(product.categoryId) : "");
  const [o1, setO1] = useState(product.option1Name ?? "");
  const [o2, setO2] = useState(product.option2Name ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [showArchived, setShowArchived] = useState(false);

  const save = (archived: boolean) =>
    start(async () => {
      const r = await saveProduct({ productId: product.id, name, brandName: brand || null, categoryId: categoryId ? Number(categoryId) : null, option1Name: o1 || null, option2Name: o2 || null, archived });
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });

  const shown = variants.filter((v) => showArchived || !v.archived);

  return (
    <div className="grid gap-5">
      <Card className="p-5 grid gap-4 md:grid-cols-[auto_1fr]">
        <StudioPhoto productId={product.id} imageUrl={product.imageUrl} isStudio={product.isStudio} enabled={studioEnabled} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Product name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <Field label="Brand"><Input id="p-brand" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
          <Field label="Category">
            <Select id="p-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Option 1" hint="e.g. Shade"><Input id="p-o1" value={o1} onChange={(e) => setO1(e.target.value)} /></Field>
          <Field label="Option 2" hint="e.g. Size"><Input id="p-o2" value={o2} disabled={!o1} onChange={(e) => setO2(e.target.value)} /></Field>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <Button onClick={() => save(product.archived)} disabled={pending}>{pending ? "Saving…" : "Save details"}</Button>
            {product.archived ? (
              <Button variant="secondary" onClick={() => save(false)} disabled={pending}>Bring back to the till</Button>
            ) : (
              <Button variant="danger" onClick={() => save(true)} disabled={pending}>Archive product</Button>
            )}
            <Msg m={msg} />
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{product.option1Name ? `${product.option1Name}s${product.option2Name ? ` & ${product.option2Name.toLowerCase()}s` : ""}` : "Price, stock and barcodes"}</h2>
        {variants.some((v) => v.archived) && <label className="text-[13px] flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>}
      </div>
      {shown.map((v) => <VariantCard key={v.id} v={v} productId={product.id} option1Name={product.option1Name} option2Name={product.option2Name} isOwner={isOwner} />)}
      {product.option1Name && <AddVariant productId={product.id} option1Name={product.option1Name} option2Name={product.option2Name} />}
    </div>
  );
}

function VariantCard({ v, productId, option1Name, option2Name, isOwner }: { v: EditableVariant; productId: number; option1Name: string | null; option2Name: string | null; isOwner: boolean }) {
  const [o1, setO1] = useState(v.option1Value ?? "");
  const [o2, setO2] = useState(v.option2Value ?? "");
  const [retail, setRetail] = useState(toInput(v.retailCents));
  const [wholesale, setWholesale] = useState(toInput(v.wholesaleCents));
  const [reorder, setReorder] = useState(String(v.reorderLevel));
  const [swatch, setSwatch] = useState(v.swatchHex ?? "");
  const [reason, setReason] = useState("");
  const [newCode, setNewCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const priceChanged = parseKES(retail) !== v.retailCents || parseKES(wholesale) !== v.wholesaleCents;
  const margin = v.avgCostCents && parseKES(retail) > 0 ? Math.round(((parseKES(retail) - v.avgCostCents) / parseKES(retail)) * 100) : null;

  const save = (archived: boolean) =>
    start(async () => {
      const r = parseKES(retail);
      const w = wholesale.trim() ? parseKES(wholesale) : 0;
      if (Number.isNaN(r) || Number.isNaN(w)) return setMsg({ ok: false, text: "Prices must be amounts." });
      const res = await saveVariant({ productId, variantId: v.id, option1Value: o1 || null, option2Value: o2 || null, reorderLevel: Math.max(0, Math.floor(Number(reorder) || 0)), swatchHex: /^#[0-9a-fA-F]{6}$/.test(swatch) ? swatch : null, archived, retailPriceCents: r, wholesalePriceCents: w, reason: reason || null });
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    });
  const barcode = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message! } : { ok: false, text: r.error! });
      if (r.ok) setNewCode("");
    });

  return (
    <Card className={`p-5 grid gap-4 ${v.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {option1Name && <span className="w-8 h-8 rounded-lg border border-ink-200" style={{ background: swatch || "var(--color-ink-50)" }} />}
          <span className="font-semibold text-[14.5px]">{[v.option1Value, v.option2Value].filter(Boolean).join(" · ") || "Standard"}</span>
          {v.archived && <Pill>Archived</Pill>}
          {v.pending.length > 0 && <Pill tone="warn">Price change waiting for the owner</Pill>}
        </div>
        <span className="text-[13px] text-ink-600 tnum">{v.onHand} in stock{v.avgCostCents !== null && <> · cost {kes(v.avgCostCents)}{margin !== null && ` · ${margin}% margin`}</>}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {option1Name && <Field label={option1Name}><Input id={`o1-${v.id}`} value={o1} onChange={(e) => setO1(e.target.value)} /></Field>}
        {option2Name && <Field label={option2Name}><Input id={`o2-${v.id}`} value={o2} onChange={(e) => setO2(e.target.value)} /></Field>}
        {option1Name && (
          <Field label="Swatch">
            <input type="color" aria-label="Swatch colour" value={swatch || "#e9d6c6"} onChange={(e) => setSwatch(e.target.value)} className="h-9 w-12 rounded-lg border border-ink-200 bg-white cursor-pointer" />
          </Field>
        )}
        <Field label="Retail (KES)"><Input id={`r-${v.id}`} inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} /></Field>
        <Field label="Wholesale (KES)"><Input id={`w-${v.id}`} inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} /></Field>
        <Field label="Reorder below"><Input id={`ro-${v.id}`} inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} /></Field>
      </div>
      {priceChanged && !isOwner && (
        <Field label="Why the price change?" hint="The owner sees this with your suggestion"><Input id={`why-${v.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Supplier raised the price" /></Field>
      )}
      <div className="grid gap-2">
        <span className="text-[12.5px] font-medium text-ink-600">Barcodes</span>
        <div className="flex flex-wrap gap-2">
          {v.barcodes.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-2 rounded-full bg-ink-50 border border-ink-200 px-3 py-1 text-[12.5px] tnum">
              {b.code}{b.source === "generated" && <span className="text-ink-400">shop label</span>}
              <button aria-label={`Remove barcode ${b.code}`} onClick={() => barcode(() => barcodeRemove(productId, b.id))} className="text-ink-400 hover:text-bad cursor-pointer">✕</button>
            </span>
          ))}
          {v.barcodes.length === 0 && <span className="text-[12.5px] text-ink-400">None — this item can only be found by name.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="New barcode" className="max-w-[220px]" placeholder="Scan to add a barcode" value={newCode} onChange={(e) => setNewCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newCode.trim()) barcode(() => barcodeAdd(productId, v.id, newCode.trim())); } }} />
          <Button variant="secondary" size="sm" disabled={pending || !newCode.trim()} onClick={() => barcode(() => barcodeAdd(productId, v.id, newCode.trim()))}>Add</Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => barcode(() => barcodeAdd(productId, v.id, null))}>Make a shop barcode</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save(v.archived)} disabled={pending}>{pending ? "Saving…" : priceChanged && !isOwner ? "Save and suggest price" : "Save"}</Button>
        {v.archived ? <Button variant="secondary" size="sm" onClick={() => save(false)} disabled={pending}>Bring back</Button> : <Button variant="ghost" size="sm" onClick={() => save(true)} disabled={pending}>Archive this {option1Name?.toLowerCase() ?? "item"}</Button>}
        <Msg m={msg} />
      </div>
    </Card>
  );
}

function AddVariant({ productId, option1Name, option2Name }: { productId: number; option1Name: string; option2Name: string | null }) {
  const [o1, setO1] = useState("");
  const [o2, setO2] = useState("");
  const [retail, setRetail] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5 grid gap-3">
      <h3 className="text-[14.5px] font-semibold">Add a {option1Name.toLowerCase()}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={option1Name}><Input id="nv-o1" value={o1} onChange={(e) => setO1(e.target.value)} /></Field>
        {option2Name && <Field label={option2Name}><Input id="nv-o2" value={o2} onChange={(e) => setO2(e.target.value)} /></Field>}
        <Field label="Retail (KES)"><Input id="nv-r" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} /></Field>
        <Field label="Wholesale (KES)"><Input id="nv-w" inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} /></Field>
        <Field label="Barcode" hint="Blank = make a shop barcode"><Input id="nv-b" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} /></Field>
      </div>
      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() => start(async () => {
            const r = parseKES(retail || "0");
            const w = wholesale.trim() ? parseKES(wholesale) : 0;
            if (Number.isNaN(r) || Number.isNaN(w)) return setMsg({ ok: false, text: "Prices must be amounts." });
            const res = await newVariant({ productId, option1Value: o1, option2Value: o2 || null, retailPriceCents: r, wholesalePriceCents: w, barcode: code.trim() || null });
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            if (res.ok) { setO1(""); setO2(""); setRetail(""); setWholesale(""); setCode(""); }
          })}
        >
          {pending ? "Adding…" : `Add ${option1Name.toLowerCase()}`}
        </Button>
        <Msg m={msg} />
      </div>
    </Card>
  );
}

/** Product photo with the Magnific studio treatment (cut-out on the brand backdrop), and undo. */
function StudioPhoto({ productId, imageUrl, isStudio, enabled }: { productId: number; imageUrl: string | null; isStudio: boolean; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? r.message : r.error);
    });
  return (
    <div className="grid gap-2 justify-items-center content-start w-32">
      <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-ink-50 border border-ink-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className={`w-full h-full object-contain transition-opacity ${pending ? "opacity-40" : ""}`} />
        ) : (
          <div className="w-full h-full grid place-items-center text-[11.5px] text-ink-400 text-center px-2">No photo yet — add one when receiving stock</div>
        )}
        {pending && <div className="absolute inset-0 grid place-items-center text-[11px] font-medium text-brand-700">Working…</div>}
        {isStudio && !pending && <span className="absolute left-1.5 top-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-white/90 text-brand-700 border-brand-tint">Studio</span>}
      </div>
      {imageUrl && enabled && (
        isStudio ? (
          <div className="flex gap-2 text-[11.5px]">
            <button type="button" disabled={pending} onClick={() => act(() => studioPhoto(productId))} className="font-medium text-brand-700 hover:underline cursor-pointer">Redo</button>
            <button type="button" disabled={pending} onClick={() => act(() => undoStudio(productId))} className="text-ink-400 hover:text-ink-900 cursor-pointer">Use original</button>
          </div>
        ) : (
          <button type="button" disabled={pending} onClick={() => act(() => studioPhoto(productId))} className="h-8 px-3 rounded-full bg-brand text-brand-ink text-[12px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 transition-colors cursor-pointer disabled:opacity-50">Make studio photo</button>
        )
      )}
      {imageUrl && !enabled && <span className="text-[10.5px] text-ink-400 text-center">Studio photos need the Magnific key</span>}
      {msg && <span className="text-[11px] text-ink-600 text-center">{msg}</span>}
    </div>
  );
}
