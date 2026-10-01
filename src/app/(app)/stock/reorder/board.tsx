"use client";

import { useState, useTransition } from "react";
import { Copy, MessageCircle, Send } from "lucide-react";
import { textSupplierOrder } from "./actions";
import { orderMessage } from "@/lib/reorder";

export interface ReorderLine {
  variantId: number;
  name: string;
  code: string | null;
  uom: string;
  perPack: number;
  onHand: number;
  perWeek: number;
  daysLeft: number | null;
  packs: number;
  urgent: boolean;
  unitCostCents: number | null;
}

export interface ReorderGroup {
  supplierId: number | null;
  supplierName: string;
  phone: string | null;
  leadDays: number;
  lines: ReorderLine[];
}

const kes = (c: number) => `KES ${Math.round(c / 100).toLocaleString("en-KE")}`;

export function ReorderBoard({ groups, canSms, shopName, shopPhone }: { groups: ReorderGroup[]; canSms: boolean; shopName: string; shopPhone: string | null }) {
  return <div className="grid gap-5">{groups.map((g) => <SupplierOrder key={g.supplierId ?? 0} g={g} canSms={canSms} shopName={shopName} shopPhone={shopPhone} />)}</div>;
}

function SupplierOrder({ g, canSms, shopName, shopPhone }: { g: ReorderGroup; canSms: boolean; shopName: string; shopPhone: string | null }) {
  const [packs, setPacks] = useState<Record<number, number>>(() => Object.fromEntries(g.lines.map((l) => [l.variantId, l.packs])));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const chosen = g.lines.filter((l) => (packs[l.variantId] ?? 0) > 0);
  const total = chosen.reduce((s, l) => s + (l.unitCostCents ?? 0) * packs[l.variantId] * l.perPack, 0);
  const costKnown = chosen.every((l) => l.unitCostCents !== null);
  const text = orderMessage({ shopName, shopPhone, lines: chosen.map((l) => ({ name: l.name, code: l.code, packs: packs[l.variantId], uom: l.uom, units: packs[l.variantId] * l.perPack })) });
  const wa = g.phone ? `https://wa.me/${g.phone.replace(/\D/g, "").replace(/^0/, "254")}?text=${encodeURIComponent(text)}` : null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-[13.5px] font-semibold">{g.supplierName}</h2>
          <p className="text-[11.5px] text-ink-400">
            {g.supplierId === null ? "Link these items to a supplier when you next receive them." : `Delivers in about ${g.leadDays} day${g.leadDays === 1 ? "" : "s"}${g.phone ? ` · ${g.phone.replace(/^254/, "0")}` : " · no phone saved"}`}
          </p>
        </div>
        <span className="text-[12px] text-ink-600 tnum">{chosen.length} item{chosen.length === 1 ? "" : "s"}{total > 0 ? ` · about ${kes(total)}${costKnown ? "" : "+"}` : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider">
              <th className="px-5 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right">On shelf</th>
              <th className="px-3 py-2.5 text-right">Sells / week</th>
              <th className="px-3 py-2.5 text-right">Lasts</th>
              <th className="px-5 py-2.5 text-right">Order</th>
            </tr>
          </thead>
          <tbody>
            {g.lines.map((l) => (
              <tr key={l.variantId} className="hairline-t">
                <td className="px-5 py-2.5">
                  <div className="font-medium">{l.name}</div>
                  {l.code && <div className="text-[11px] text-ink-400">Code {l.code}</div>}
                </td>
                <td className="px-3 py-2.5 text-right tnum">{l.onHand}</td>
                <td className="px-3 py-2.5 text-right tnum text-ink-600">{l.perWeek || "—"}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {l.daysLeft === null ? (
                    <span className="text-ink-400">Below level</span>
                  ) : (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border tnum ${l.urgent ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{l.daysLeft} day{l.daysLeft === 1 ? "" : "s"}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <input
                    type="number"
                    min={0}
                    value={packs[l.variantId] ?? 0}
                    onChange={(e) => setPacks((p) => ({ ...p, [l.variantId]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                    className="h-8 w-16 rounded-lg border border-ink-200 bg-white px-2 text-right tnum focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint"
                    aria-label={`Packs of ${l.name}`}
                  />
                  <span className="ml-1.5 text-[11.5px] text-ink-400">{l.uom}{l.perPack > 1 ? ` (${(packs[l.variantId] ?? 0) * l.perPack} pcs)` : ""}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {g.supplierId !== null && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3 flex flex-wrap items-center gap-2">
          {canSms && (
            <button disabled={pending || chosen.length === 0} onClick={() => start(async () => setMsg(await textSupplierOrder(g.supplierId!, text, chosen.length)))} className="h-9 px-3.5 rounded-lg bg-brand text-brand-ink text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 cursor-pointer disabled:opacity-50">
              <Send aria-hidden="true" className="size-3.5" /> {pending ? "Sending…" : "Text order"}
            </button>
          )}
          {wa && chosen.length > 0 && (
            <a href={wa} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-lg bg-white border border-ink-200 text-[13px] font-medium text-ink-600 inline-flex items-center gap-1.5 hover:bg-ink-50">
              <MessageCircle aria-hidden="true" className="size-3.5" /> WhatsApp
            </a>
          )}
          <button disabled={chosen.length === 0} onClick={() => navigator.clipboard.writeText(text).then(() => setMsg({ ok: "Order copied." }))} className="h-9 px-3 rounded-lg text-[13px] text-ink-600 inline-flex items-center gap-1.5 hover:bg-white cursor-pointer disabled:opacity-50">
            <Copy aria-hidden="true" className="size-3.5" /> Copy
          </button>
          {msg.error && <span className="text-bad text-[12.5px]">{msg.error}</span>}
          {msg.ok && <span className="text-good text-[12.5px]">{msg.ok}</span>}
        </div>
      )}
    </section>
  );
}
