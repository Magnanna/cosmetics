"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCount, finishCounting, saveCount } from "../../actions";
import type { PickVariant } from "@/lib/picklist";
import { VariantSearch } from "@/components/variant-search";
import { Button } from "@/components/ui";

interface Line { variantId: number; name: string; counted: number | null }

/**
 * Blind count: staff never see what the system expects. Scanning adds 1;
 * typing a number sets the total. Every change saves immediately.
 */
export function CountScreen({ stockTakeId, canCancel, lines: initial, picklist }: { stockTakeId: number; canCancel: boolean; lines: Line[]; picklist: PickVariant[] }) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  const counted = lines.filter((l) => l.counted !== null).length;
  const shown = useMemo(() => (filter === "todo" ? lines.filter((l) => l.counted === null) : lines), [lines, filter]);

  async function save(variantId: number, name: string, qty: number, mode: "set" | "add") {
    const r = await saveCount({ stockTakeId, variantId, qty, mode });
    if (!r.ok) return setFlash({ text: r.error, bad: true });
    setLines((ls) => (ls.some((l) => l.variantId === variantId) ? ls.map((l) => (l.variantId === variantId ? { ...l, counted: r.counted } : l)) : [...ls, { variantId, name, counted: r.counted }]));
    setFlash({ text: `${name}: ${r.counted}` });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
      <div className="grid gap-3">
        <div className="card p-4 grid gap-2">
          <span className="text-[13px] font-medium text-ink-600">Scan each item (every scan adds 1), or search and type the total below</span>
          <VariantSearch
            ref={scanRef}
            autoFocus
            variants={picklist}
            placeholder="Scan or search"
            onPick={(v) => save(v.id, v.label, 1, "add").then(() => scanRef.current?.focus())}
            onUnknownBarcode={(code) => setFlash({ text: `Barcode ${code} isn't on any product. Put the item aside for the owner.`, bad: true })}
          />
          {flash && <p className={`text-[13.5px] ${flash.bad ? "text-bad" : "text-good"}`}>{flash.bad ? "" : "✓ "}{flash.text}</p>}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
            <div className="flex gap-1.5">
              {(["todo", "all"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`h-8 px-3 rounded-full text-[12.5px] cursor-pointer border-[0.5px] ${filter === f ? "bg-brand-tint text-brand-700 border-transparent font-semibold" : "border-ink-200 text-ink-600"}`}>
                  {f === "todo" ? `Not counted (${lines.length - counted})` : `All (${lines.length})`}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="p-6 text-[13.5px] text-ink-400 text-center">{filter === "todo" ? "Everything in this count has been counted." : "Nothing here."}</p>
          ) : (
            <ul className="divide-y-[0.5px] divide-ink-100 max-h-[60vh] overflow-y-auto">
              {shown.map((l) => (
                <li key={l.variantId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                  <span>{l.name}</span>
                  <input
                    aria-label={`Count for ${l.name}`}
                    inputMode="numeric"
                    defaultValue={l.counted ?? ""}
                    key={`${l.variantId}-${l.counted}`}
                    placeholder="—"
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === "" || Number(v) === l.counted) return;
                      const n = Number(v);
                      if (!Number.isInteger(n) || n < 0) return setFlash({ text: "Counts are whole numbers.", bad: true });
                      save(l.variantId, l.name, n, "set");
                    }}
                    className="h-9 w-20 rounded-md bg-white px-2 text-right tnum border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card p-5 grid gap-3">
        <div className="text-[13px] text-ink-400">Progress</div>
        <div className="money-lg">{counted} <span className="text-ink-400 text-[15px] font-normal">of {lines.length}</span></div>
        <div className="h-2 rounded-full bg-ink-100 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${lines.length ? (counted / lines.length) * 100 : 0}%` }} /></div>
        <p className="text-[12.5px] text-ink-400">Items you don't count are left as they are. Sales can carry on while you count.</p>
        <Button
          disabled={pending || counted === 0}
          onClick={() => start(async () => {
            const r = await finishCounting(stockTakeId);
            if (r.ok) router.refresh();
            else setFlash({ text: r.error, bad: true });
          })}
        >
          Submit for approval
        </Button>
        {canCancel && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await cancelCount(stockTakeId); if (r.ok) router.push("/stock/counts"); else setFlash({ text: r.error, bad: true }); })}>
            Cancel this count
          </Button>
        )}
      </div>
    </div>
  );
}
