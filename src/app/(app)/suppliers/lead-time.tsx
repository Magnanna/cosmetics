"use client";

import { useState, useTransition } from "react";
import { setLeadTime } from "./actions";

export function LeadTime({ supplierId, days }: { supplierId: number; days: number }) {
  const [v, setV] = useState(String(days));
  const [pending, start] = useTransition();
  const save = () => {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n !== days) start(() => setLeadTime(supplierId, n));
  };
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} inputMode="numeric" aria-label="Delivery time in days" className={`h-8 w-14 rounded-lg border border-ink-200 bg-white px-2 text-right tnum focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint ${pending ? "opacity-50" : ""}`} />
      <span className="text-[12px] text-ink-400">days</span>
    </span>
  );
}
