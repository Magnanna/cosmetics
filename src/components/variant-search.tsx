"use client";

import { forwardRef, useState } from "react";
import type { PickVariant } from "@/lib/picklist";

/**
 * Search by name/shade, or scan a barcode and press Enter (scanners send Enter).
 * Calls onPick with the chosen variant and clears itself.
 */
export const VariantSearch = forwardRef<HTMLInputElement, {
  variants: PickVariant[];
  onPick: (v: PickVariant) => void;
  onUnknownBarcode?: (code: string) => void;
  placeholder?: string;
  showStock?: boolean;
  autoFocus?: boolean;
}>(function VariantSearch({ variants, onPick, onUnknownBarcode, placeholder, showStock, autoFocus }, ref) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const matches = term.length >= 2 ? variants.filter((v) => v.label.toLowerCase().includes(term) || v.barcodes.some((b) => b.includes(term))).slice(0, 8) : [];

  const pick = (v: PickVariant) => {
    onPick(v);
    setQ("");
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const code = q.trim();
          const exact = variants.find((v) => v.barcodes.includes(code));
          if (exact) return pick(exact);
          if (matches.length === 1) return pick(matches[0]);
          if (/^\d{6,}$/.test(code)) {
            onUnknownBarcode?.(code);
            setQ("");
          }
        }}
        placeholder={placeholder ?? "Search product or scan barcode"}
        className="h-11 w-full rounded-lg bg-white px-3 text-[15px] border border-ink-200 placeholder:text-ink-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint"
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 card py-1 max-h-72 overflow-y-auto">
          {matches.map((v) => (
            <li key={v.id}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-ink-50 cursor-pointer flex justify-between gap-3 text-[13.5px]" onClick={() => pick(v)}>
                <span>{v.label}</span>
                {showStock && <span className="text-ink-400 tnum">{v.onHand} in stock</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
