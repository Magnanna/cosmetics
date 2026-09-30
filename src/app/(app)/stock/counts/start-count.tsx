"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginStockTake } from "../actions";
import { Button } from "@/components/ui";

type Kind = "all" | "categories" | "brands";

export function StartCount({ categories, brands }: { categories: { id: number; name: string }[]; brands: { id: number; name: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("categories");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const options = kind === "categories" ? categories : kind === "brands" ? brands : [];

  const toggle = (id: number) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <div className="card p-5 grid gap-3">
      <h2 className="text-[13.5px] font-semibold">Start a count</h2>
      <p className="text-[13px] text-ink-400">Counting a few categories each week is easier than the whole shop at once.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(["categories", "brands", "all"] as Kind[]).map((k) => (
          <button key={k} onClick={() => { setKind(k); setPicked(new Set()); }} className={`h-9 rounded-lg text-[13px] font-medium cursor-pointer border ${kind === k ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200 hover:bg-ink-50"}`}>
            {k === "all" ? "Everything" : k === "categories" ? "Categories" : "Brands"}
          </button>
        ))}
      </div>
      {kind !== "all" && (
        options.length === 0 ? <p className="text-[13px] text-ink-400">No {kind} yet.</p> : (
          <div className="grid gap-1 max-h-72 overflow-y-auto">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13.5px] px-1 py-1 rounded hover:bg-ink-50">
                <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
                {o.name}
              </label>
            ))}
          </div>
        )
      )}
      {error && <p className="text-bad text-[13px]">{error}</p>}
      <Button
        disabled={pending || (kind !== "all" && picked.size === 0)}
        onClick={() => start(async () => {
          setError(null);
          const r = await beginStockTake(kind === "all" ? { kind } : { kind, ids: [...picked] });
          if (r.ok) router.push(`/stock/counts/${r.id}`);
          else setError(r.error);
        })}
      >
        {pending ? "Starting…" : "Start counting"}
      </Button>
    </div>
  );
}
