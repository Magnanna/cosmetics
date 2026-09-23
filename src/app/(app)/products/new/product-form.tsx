"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProduct, type ProductInput } from "../actions";
import { parseKES } from "@/lib/money";
import { Button, Card, Field, Input, Select } from "@/components/ui";

interface Row {
  key: number;
  option1Value: string;
  option2Value: string;
  barcode: string;
  generateBarcode: boolean;
  retail: string;
  wholesale: string;
  reorderLevel: string;
  swatchHex: string;
  openingQty: string;
  openingUnitCost: string;
}

let nextKey = 1;
const blankRow = (): Row => ({
  key: nextKey++,
  option1Value: "",
  option2Value: "",
  barcode: "",
  generateBarcode: false,
  retail: "",
  wholesale: "",
  reorderLevel: "0",
  swatchHex: "",
  openingQty: "0",
  openingUnitCost: "",
});

const OPTION_PRESETS = ["Shade", "Size", "Colour", "Scent", "Finish"];

export function ProductForm({
  brands,
  categories,
  canStock,
}: {
  brands: { id: number; name: string }[];
  categories: { id: number; label: string }[];
  canStock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState<string>("");
  const [newBrand, setNewBrand] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [option1, setOption1] = useState("");
  const [option2, setOption2] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);

  const hasOptions = option1.trim() !== "";
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function submit() {
    setError(null);
    const money = (v: string, label: string) => {
      if (v.trim() === "") return 0;
      const c = parseKES(v);
      if (Number.isNaN(c) || c < 0) throw new Error(`${label} isn't a valid amount.`);
      return c;
    };
    let payload: ProductInput;
    try {
      payload = {
        name,
        brandId: brand && brand !== "__new" ? Number(brand) : null,
        newBrandName: brand === "__new" ? newBrand.trim() || null : null,
        categoryId: categoryId ? Number(categoryId) : null,
        option1Name: hasOptions ? option1.trim() : null,
        option2Name: hasOptions && option2.trim() ? option2.trim() : null,
        variants: rows.map((r, i) => {
          const n = `Variant ${i + 1}`;
          const qty = Number(r.openingQty || 0);
          if (!Number.isInteger(qty) || qty < 0) throw new Error(`${n}: opening quantity must be a whole number.`);
          const unitCost = money(r.openingUnitCost, `${n} cost`);
          if (qty > 0 && unitCost === 0) throw new Error(`${n}: enter what one unit cost you, so stock is valued correctly.`);
          return {
            option1Value: r.option1Value.trim() || null,
            option2Value: r.option2Value.trim() || null,
            barcode: r.barcode.trim() || null,
            generateBarcode: !r.barcode.trim() && r.generateBarcode,
            retailPriceCents: money(r.retail, `${n} retail price`),
            wholesalePriceCents: money(r.wholesale, `${n} wholesale price`),
            reorderLevel: Math.max(0, Math.floor(Number(r.reorderLevel || 0))),
            swatchHex: /^#[0-9a-fA-F]{6}$/.test(r.swatchHex) ? r.swatchHex : null,
            openingQty: qty,
            openingUnitCostCents: unitCost,
          };
        }),
      };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    start(async () => {
      const res = await createProduct(payload);
      if (res.error) setError(res.error);
      else router.push("/products");
    });
  }

  return (
    <div className="grid gap-5">
      <Card className="p-5 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Product name" hint="As the customer knows it, without the shade — e.g. “Lush Hair Leave-in Treatment 40g”">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        </div>
        <Field label="Brand">
          <Select id="brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">No brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="__new">+ New brand…</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        {brand === "__new" && (
          <Field label="New brand name"><Input id="newBrand" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} /></Field>
        )}
      </Card>

      <Card className="p-5 grid gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Shades, sizes and other options</h2>
          <p className="text-[13px] text-ink-400">Leave blank if the product comes in only one version.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Option 1" hint="e.g. Shade">
            <Input id="option1" list="option-presets" value={option1} onChange={(e) => setOption1(e.target.value)} />
          </Field>
          <Field label="Option 2" hint="e.g. Size">
            <Input id="option2" list="option-presets" value={option2} disabled={!hasOptions} onChange={(e) => setOption2(e.target.value)} />
          </Field>
          <datalist id="option-presets">{OPTION_PRESETS.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
      </Card>

      <Card className="p-5 grid gap-4">
        <h2 className="text-[15px] font-semibold">{hasOptions ? "Variants" : "Price, barcode and stock"}</h2>
        {rows.map((r, i) => (
          <div key={r.key} className={`grid gap-3 ${i > 0 ? "hairline-t pt-4" : ""}`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {hasOptions && (
                <Field label={option1 || "Option 1"}>
                  <Input id={`o1-${r.key}`} value={r.option1Value} onChange={(e) => update(r.key, { option1Value: e.target.value })} />
                </Field>
              )}
              {hasOptions && option2.trim() && (
                <Field label={option2}>
                  <Input id={`o2-${r.key}`} value={r.option2Value} onChange={(e) => update(r.key, { option2Value: e.target.value })} />
                </Field>
              )}
              {hasOptions && (
                <Field label="Swatch colour" hint="Shown on the till">
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      aria-label="Swatch colour"
                      className="h-9 w-10 rounded-md border-[0.5px] border-ink-200 bg-white cursor-pointer"
                      value={r.swatchHex || "#e9d6c6"}
                      onChange={(e) => update(r.key, { swatchHex: e.target.value })}
                    />
                    {r.swatchHex && <button type="button" className="text-[12px] text-ink-400 cursor-pointer" onClick={() => update(r.key, { swatchHex: "" })}>Clear</button>}
                  </div>
                </Field>
              )}
              <Field label="Barcode" hint="Scan the one on the pack">
                <Input
                  id={`bc-${r.key}`}
                  value={r.barcode}
                  inputMode="numeric"
                  onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                  onChange={(e) => update(r.key, { barcode: e.target.value })}
                />
              </Field>
            </div>
            {!r.barcode && (
              <label className="flex items-center gap-2 text-[13px] text-ink-600">
                <input type="checkbox" checked={r.generateBarcode} onChange={(e) => update(r.key, { generateBarcode: e.target.checked })} />
                No barcode on the pack — create one for our own labels
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Retail price (KES)"><Input id={`rp-${r.key}`} inputMode="decimal" value={r.retail} onChange={(e) => update(r.key, { retail: e.target.value })} /></Field>
              <Field label="Wholesale price (KES)"><Input id={`wp-${r.key}`} inputMode="decimal" value={r.wholesale} onChange={(e) => update(r.key, { wholesale: e.target.value })} /></Field>
              <Field label="Reorder when below"><Input id={`rl-${r.key}`} inputMode="numeric" value={r.reorderLevel} onChange={(e) => update(r.key, { reorderLevel: e.target.value })} /></Field>
              {canStock && <Field label="Units in shop now"><Input id={`oq-${r.key}`} inputMode="numeric" value={r.openingQty} onChange={(e) => update(r.key, { openingQty: e.target.value })} /></Field>}
              {canStock && <Field label="Cost per unit (KES)" hint="Incl. supplier VAT"><Input id={`oc-${r.key}`} inputMode="decimal" value={r.openingUnitCost} onChange={(e) => update(r.key, { openingUnitCost: e.target.value })} /></Field>}
            </div>
            {rows.length > 1 && (
              <div><Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove variant</Button></div>
            )}
          </div>
        ))}
        {hasOptions && (
          <div><Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])}>+ Add variant</Button></div>
        )}
      </Card>

      {error && <div role="alert" className="text-bad text-[13.5px]">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending} size="lg">{pending ? "Saving…" : "Save product"}</Button>
        <Button variant="secondary" size="lg" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}
