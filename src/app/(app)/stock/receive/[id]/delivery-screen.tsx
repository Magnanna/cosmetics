"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { addExisting, createAndAdd, discardDelivery, editLine, phonePhotoLink, saveDelivery, scan } from "../actions";
import type { BarcodeInfo } from "@/lib/barcode-lookup";
import { billTotals } from "@/lib/landed-cost";
import { parseKES } from "@/lib/money";
import type { PickVariant } from "@/lib/picklist";
import { Button, Field, Input, Select } from "@/components/ui";

export interface DeliveryLine {
  variantId: number;
  productId: number;
  name: string;
  imageUrl: string | null;
  barcode: string | null;
  qty: number;
  unitRateCents: number | null;
  retailCents: number;
  wholesaleCents: number;
}

type NewItemDraft = { barcode: string | null; suggestion: BarcodeInfo | null };

const kes = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-KE")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function DeliveryScreen({
  receivingId,
  ratesIncludeVat,
  initialLines,
  picklist,
  categories,
  products,
  photosEnabled,
}: {
  receivingId: number;
  ratesIncludeVat: boolean;
  initialLines: DeliveryLine[];
  picklist: PickVariant[];
  categories: { id: number; label: string }[];
  products: { id: number; name: string; option1Name: string | null }[];
  photosEnabled: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [newItem, setNewItem] = useState<NewItemDraft | null>(null);
  const [photoFor, setPhotoFor] = useState<DeliveryLine | null>(null);
  const [paperTotal, setPaperTotal] = useState("");
  const [busy, startBusy] = useTransition();
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLines(initialLines), [initialLines]);

  const term = input.trim().toLowerCase();
  const matches = term.length >= 2 && !/^\d+$/.test(term) ? picklist.filter((v) => v.label.toLowerCase().includes(term)).slice(0, 8) : [];

  async function handleScan(code: string) {
    setScanning(true);
    const r = await scan(receivingId, code);
    setScanning(false);
    if (!r.ok) return setFlash({ text: r.error, bad: true });
    if (r.data.kind === "added") {
      const { variantId, qty } = r.data;
      const known = lines.find((l) => l.variantId === variantId);
      if (known) {
        setLines((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, qty } : l)));
        setFlash({ text: `${known.name} · ${qty}` });
      } else {
        setFlash({ text: `Added ${picklist.find((p) => p.id === variantId)?.label ?? "item"}` });
        router.refresh();
      }
    } else {
      setNewItem({ barcode: r.data.code, suggestion: r.data.suggestion });
    }
  }

  async function addPicked(v: PickVariant) {
    setInput("");
    const r = await addExisting(receivingId, v.id, 1);
    if (!r.ok) return setFlash({ text: r.error, bad: true });
    setFlash({ text: `${v.label} · ${r.data}` });
    if (lines.some((l) => l.variantId === v.id)) setLines((ls) => ls.map((l) => (l.variantId === v.id ? { ...l, qty: r.data } : l)));
    else router.refresh();
    scanRef.current?.focus();
  }

  async function patchLine(variantId: number, patch: { qty?: number; unitRateCents?: number | null }) {
    const r = await editLine(receivingId, variantId, patch);
    if (!r.ok) return setFlash({ text: r.error, bad: true });
    setLines((ls) => (patch.qty === 0 ? ls.filter((l) => l.variantId !== variantId) : ls.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l))));
  }

  const priced = lines.filter((l) => l.unitRateCents !== null);
  const totals = billTotals(priced.map((l) => ({ qty: l.qty, unitsPerUom: 1, rateCents: l.unitRateCents!, vatBp: 1600, rateIncludesVat: ratesIncludeVat })));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const missingCost = lines.length - priced.length;
  const paperCents = paperTotal.trim() ? parseKES(paperTotal) : NaN;
  const matchesPaper = !Number.isNaN(paperCents) && paperCents === totals.totalCents;

  return (
    <div className="grid gap-5">
      <div className="card p-4 grid gap-2 relative">
        <div className="flex gap-2">
          <input
            ref={scanRef}
            autoFocus
            value={input}
            disabled={!!newItem}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = input.trim();
              if (!v) return;
              if (/^\d{6,14}$/.test(v)) { setInput(""); handleScan(v); }
              else if (matches.length === 1) addPicked(matches[0]);
            }}
            placeholder={scanning ? "Looking up…" : "Scan a barcode — or type a product name"}
            className="h-12 flex-1 rounded-xl bg-white px-4 text-[15px] border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint"
          />
          <Button variant="secondary" size="lg" onClick={() => setNewItem({ barcode: null, suggestion: null })}>No barcode</Button>
        </div>
        {matches.length > 0 && (
          <ul className="absolute z-20 left-4 right-4 top-[64px] card py-1 max-h-72 overflow-y-auto">
            {matches.map((v) => (
              <li key={v.id}><button className="w-full text-left px-3 py-2 hover:bg-ink-50 cursor-pointer text-[13.5px]" onClick={() => addPicked(v)}>{v.label}</button></li>
            ))}
          </ul>
        )}
        <p className={`text-[13px] min-h-[1.2em] ${flash?.bad ? "text-bad" : "text-good"}`}>{flash ? `${flash.bad ? "" : "✓ "}${flash.text}` : ""}</p>
      </div>

      <div className="card overflow-x-auto">
        {lines.length === 0 ? (
          <p className="p-8 text-center text-[13.5px] text-ink-400">Scan the first item. Known products count up; new ones open a short form with the name filled in.</p>
        ) : (
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-3 py-3 font-semibold text-right w-[100px]">Qty</th>
                <th className="px-3 py-3 font-semibold text-right w-[140px]">Cost / unit</th>
                <th className="px-3 py-3 font-semibold text-right w-[120px]">Line</th>
                <th className="px-3 py-3 font-semibold text-right w-[150px]">Sells at</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.variantId} className="hairline-t align-middle">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {l.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover bg-ink-50" />
                      ) : (
                        <button onClick={() => setPhotoFor(l)} className="w-10 h-10 rounded-md bg-ink-50 border-[0.5px] border-dashed border-ink-200 text-[10px] text-ink-400 leading-tight cursor-pointer hover:border-brand">Add photo</button>
                      )}
                      <div>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-[11.5px] text-ink-400 tnum">{l.barcode ?? "no barcode"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      aria-label={`Quantity of ${l.name}`}
                      key={`q-${l.variantId}-${l.qty}`}
                      defaultValue={l.qty}
                      inputMode="numeric"
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n === l.qty) return;
                        if (!Number.isInteger(n) || n < 0) { e.target.value = String(l.qty); return; }
                        patchLine(l.variantId, { qty: n });
                      }}
                      className="h-9 w-full rounded-md bg-white px-2 text-right tnum border-[0.5px] border-ink-200 focus:border-brand focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      aria-label={`Cost per unit of ${l.name}`}
                      key={`r-${l.variantId}-${l.unitRateCents}`}
                      defaultValue={l.unitRateCents === null ? "" : (l.unitRateCents / 100).toFixed(2)}
                      inputMode="decimal"
                      placeholder="from invoice"
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const c = v === "" ? null : parseKES(v);
                        if (c === l.unitRateCents) return;
                        if (c !== null && (Number.isNaN(c) || c < 0)) { setFlash({ text: "That cost isn't a valid amount.", bad: true }); return; }
                        patchLine(l.variantId, { unitRateCents: c });
                      }}
                      className={`h-9 w-full rounded-md bg-white px-2 text-right tnum border-[0.5px] focus:border-brand focus:outline-none ${l.unitRateCents === null ? "border-warn" : "border-ink-200"}`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right tnum">{l.unitRateCents === null ? "—" : kes(l.unitRateCents * l.qty)}</td>
                  <td className="px-3 py-2.5 text-right text-[12.5px] text-ink-600 tnum">
                    {kes(l.retailCents)}
                    {l.wholesaleCents > 0 && <div className="text-ink-400">wholesale {kes(l.wholesaleCents)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_360px] items-start">
        <div className="text-[13px] text-ink-400 grid gap-1 max-w-prose">
          <p>{units} units · {lines.length} products{missingCost > 0 ? ` · ${missingCost} still need a cost` : ""}.</p>
          <p>Cost per unit is the rate printed on the supplier invoice. Because the shop isn't VAT registered, any VAT on it is part of the stock cost.</p>
        </div>
        <div className="card p-5 grid gap-2 text-[13.5px]">
          <div className="flex justify-between"><span className="text-ink-600">Net</span><span className="tnum">{kes(totals.netCents)}</span></div>
          <div className="flex justify-between"><span className="text-ink-600">VAT 16%</span><span className="tnum">{kes(totals.vatCents)}</span></div>
          <div className="flex justify-between text-[17px] font-semibold"><span>Invoice total</span><span className="tnum">{kes(totals.totalCents)}</span></div>
          <Field label="Total printed on the invoice" hint={Number.isNaN(paperCents) ? "Type it to double-check" : matchesPaper ? "✓ Matches" : "Doesn't match yet"}>
            <Input id="paper" inputMode="decimal" value={paperTotal} onChange={(e) => setPaperTotal(e.target.value)} placeholder="6,960.00" />
          </Field>
          <Button
            size="lg"
            disabled={busy || lines.length === 0}
            onClick={() => {
              if (!Number.isNaN(paperCents) && !matchesPaper) return setFlash({ text: `Scanned lines add up to ${kes(totals.totalCents)}, the invoice says ${kes(paperCents)}. Check quantities and costs.`, bad: true });
              startBusy(async () => {
                const r = await saveDelivery(receivingId);
                if (r.ok) router.push("/stock/bills");
                else setFlash({ text: r.error, bad: true });
              });
            }}
          >
            {busy ? "Saving…" : "Save delivery — add to stock"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => startBusy(async () => { const r = await discardDelivery(receivingId); if (r.ok) router.push("/stock/receive"); else setFlash({ text: r.error, bad: true }); })}>
            Discard this delivery
          </Button>
        </div>
      </div>

      {newItem && (
        <NewItemPanel
          draft={newItem}
          categories={categories}
          products={products}
          onCancel={() => { setNewItem(null); setTimeout(() => scanRef.current?.focus()); }}
          onSave={async (payload) => {
            const r = await createAndAdd(receivingId, payload);
            if (!r.ok) return r.error;
            setNewItem(null);
            setFlash({ text: `Created ${payload.attachToProductId ? payload.optionValue : payload.name}` });
            router.refresh();
            setTimeout(() => scanRef.current?.focus());
            return null;
          }}
        />
      )}
      {photoFor && <PhonePhoto line={photoFor} enabled={photosEnabled} onClose={() => { setPhotoFor(null); router.refresh(); }} />}
    </div>
  );
}

function NewItemPanel({
  draft,
  categories,
  products,
  onCancel,
  onSave,
}: {
  draft: NewItemDraft;
  categories: { id: number; label: string }[];
  products: { id: number; name: string; option1Name: string | null }[];
  onCancel: () => void;
  onSave: (p: Parameters<typeof createAndAdd>[1]) => Promise<string | null>;
}) {
  const s = draft.suggestion;
  const [name, setName] = useState([s?.name, s?.size && !s.name?.includes(s.size) ? s.size : null].filter(Boolean).join(" "));
  const [brand, setBrand] = useState(s?.brand ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [attach, setAttach] = useState<{ id: number; name: string } | null>(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [optionValue, setOptionValue] = useState("");
  const [swatch, setSwatch] = useState("");
  const [retail, setRetail] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = attachSearch.trim().toLowerCase();
  const attachMatches = q.length >= 2 ? products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6) : [];

  function submit() {
    setError(null);
    const money = (v: string, label: string, required: boolean) => {
      if (!v.trim()) {
        if (required) throw new Error(`Enter the ${label}.`);
        return 0;
      }
      const c = parseKES(v);
      if (Number.isNaN(c) || c < 0) throw new Error(`The ${label} isn't a valid amount.`);
      return c;
    };
    let payload: Parameters<typeof createAndAdd>[1];
    try {
      const n = Number(qty);
      if (!Number.isInteger(n) || n < 1) throw new Error("Quantity must be at least 1.");
      payload = {
        barcode: draft.barcode,
        name,
        brandName: attach ? null : brand.trim() || null,
        categoryId: attach || !categoryId ? null : Number(categoryId),
        attachToProductId: attach?.id ?? null,
        optionValue: attach ? optionValue.trim() || null : null,
        swatchHex: attach && /^#[0-9a-fA-F]{6}$/.test(swatch) ? swatch : null,
        retailPriceCents: money(retail, "retail price", true),
        wholesalePriceCents: money(wholesale, "wholesale price", false),
        qty: n,
        unitRateCents: cost.trim() ? money(cost, "cost", false) : null,
        imageUrl: s?.imageUrl ?? null,
      };
    } catch (e) {
      return setError((e as Error).message);
    }
    start(async () => {
      const err = await onSave(payload);
      if (err) setError(err);
    });
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4">
      <div className="card p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto grid gap-3">
        <div className="flex items-start gap-3">
          {s?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.imageUrl} alt="" className="w-16 h-16 rounded-lg object-contain bg-ink-50 shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-ink-50 grid place-items-center text-[11px] text-ink-400 shrink-0 text-center">No photo</div>
          )}
          <div className="grid gap-0.5">
            <h2 className="text-[16px] font-semibold">New product</h2>
            <p className="text-[12.5px] text-ink-400">
              {draft.barcode ? <>Barcode <span className="tnum">{draft.barcode}</span> · {s ? `found on ${s.source === "shop" ? "another Kenfri shop" : s.source}` : "not found online — type the name"}</> : "No barcode — we'll make one for your labels"}
            </p>
          </div>
        </div>

        {attach ? (
          <div className="rounded-lg bg-brand-wash px-3 py-2.5 grid gap-2">
            <div className="flex justify-between text-[13.5px]"><span>New shade/size of <b>{attach.name}</b></span><button className="text-ink-600 cursor-pointer" onClick={() => setAttach(null)}>Undo</button></div>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <Field label="Shade or size"><Input id="n-opt" value={optionValue} onChange={(e) => setOptionValue(e.target.value)} placeholder="e.g. Honey" autoFocus /></Field>
              <input type="color" aria-label="Swatch colour" value={swatch || "#e9d6c6"} onChange={(e) => setSwatch(e.target.value)} className="h-9 w-10 rounded-md border-[0.5px] border-ink-200 bg-white cursor-pointer" />
            </div>
          </div>
        ) : (
          <>
            <Field label="Product name" hint="As customers know it, e.g. “Nivea Soft 200ml”"><Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Brand"><Input id="n-brand" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
              <Field label="Category">
                <Select id="n-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
            </div>
            <div className="relative">
              <Field label="…or is it another shade/size of a product you already have?">
                <Input id="n-attach" value={attachSearch} onChange={(e) => setAttachSearch(e.target.value)} placeholder="Search your products" />
              </Field>
              {attachMatches.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 card py-1">
                  {attachMatches.map((p) => (
                    <li key={p.id}><button className="w-full text-left px-3 py-2 hover:bg-ink-50 cursor-pointer text-[13.5px]" onClick={() => { setAttach(p); setAttachSearch(""); }}>{p.name}{p.option1Name ? <span className="text-ink-400"> · has {p.option1Name.toLowerCase()}s</span> : null}</button></li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Retail price (KES)"><Input id="n-retail" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} /></Field>
          <Field label="Wholesale price (KES)"><Input id="n-whole" inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} /></Field>
          <Field label="How many arrived"><Input id="n-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Cost per unit (KES)" hint="Rate on the invoice"><Input id="n-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
        {error && <p role="alert" className="text-bad text-[13px]">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending} size="lg" className="flex-1">{pending ? "Saving…" : "Save and add to delivery"}</Button>
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={pending}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function PhonePhoto({ line, enabled, onClose }: { line: DeliveryLine; enabled: boolean; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    phonePhotoLink(line.productId).then(async (r) => {
      if (!r.ok) return setError(r.error);
      setUrl(r.data.url);
      setQr(await QRCode.toDataURL(r.data.url, { margin: 1, width: 220 }));
    });
    // Pick up the photo as soon as the phone uploads it.
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [enabled, line.productId, router]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card p-6 w-full max-w-sm grid gap-3 justify-items-center text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">Photo for {line.name}</h2>
        {!enabled ? (
          <p className="text-[13.5px] text-ink-600">Photo uploads aren't switched on yet. Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> and restart.</p>
        ) : error ? (
          <p className="text-[13.5px] text-bad">{error}</p>
        ) : qr ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to open the phone camera page" width={220} height={220} />
            <p className="text-[13px] text-ink-600">Scan with your phone camera, take the photo, and it appears here. The link works for 30 minutes.</p>
            <p className="text-[11.5px] text-ink-400 break-all select-all">{url}</p>
          </>
        ) : (
          <p className="text-[13px] text-ink-400">Making a link…</p>
        )}
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
