"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveCount, cancelCount } from "../../actions";
import type { ReviewLine } from "@/lib/stocktake";
import { Button, Money, Pill } from "@/components/ui";

export function ReviewScreen({ stockTakeId, status, canApprove, lines, varianceCostCents }: { stockTakeId: number; status: string; canApprove: boolean; lines: ReviewLine[]; varianceCostCents: number | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const counted = lines.filter((l) => l.countedQty !== null);
  const differences = counted.filter((l) => l.differenceQty !== 0);
  const shortage = differences.reduce((s, l) => s + Math.min(0, l.differenceCents ?? 0), 0);
  const surplus = differences.reduce((s, l) => s + Math.max(0, l.differenceCents ?? 0), 0);
  const uncounted = lines.length - counted.length;
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.ok) router.refresh();
    else setError(r.error);
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold text-right">System</th>
              <th className="px-4 py-3 font-semibold text-right">Counted</th>
              <th className="px-4 py-3 font-semibold text-right">Difference</th>
              <th className="px-4 py-3 font-semibold text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.variantId} className={`hairline-t ${l.countedQty === null ? "text-ink-400" : ""}`}>
                <td className="px-4 py-2.5">{l.name}</td>
                <td className="px-4 py-2.5 text-right tnum">{l.systemQtyAtCount ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{l.countedQty ?? "Not counted"}</td>
                <td className={`px-4 py-2.5 text-right tnum ${(l.differenceQty ?? 0) < 0 ? "text-bad" : (l.differenceQty ?? 0) > 0 ? "text-good" : ""}`}>
                  {l.differenceQty === null ? "—" : l.differenceQty > 0 ? `+${l.differenceQty}` : l.differenceQty}
                </td>
                <td className="px-4 py-2.5 text-right">{l.differenceCents === null || l.differenceCents === 0 ? "—" : <Money cents={l.differenceCents} className={l.differenceCents < 0 ? "text-bad" : "text-good"} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5 grid gap-3 text-[13.5px]">
        {status === "approved" && <Pill tone="good">Approved</Pill>}
        {status === "cancelled" && <Pill>Cancelled — nothing was changed</Pill>}
        <div className="flex justify-between"><span className="text-ink-600">Counted</span><span className="tnum">{counted.length} of {lines.length}</span></div>
        <div className="flex justify-between"><span className="text-ink-600">With a difference</span><span className="tnum">{differences.length}</span></div>
        <div className="flex justify-between"><span className="text-ink-600">Missing stock</span><Money cents={shortage} className="text-bad" /></div>
        <div className="flex justify-between"><span className="text-ink-600">Extra stock</span><Money cents={surplus} className="text-good" /></div>
        {status === "approved" && varianceCostCents !== null && (
          <div className="flex justify-between font-semibold hairline-t pt-2"><span>Posted to the books</span><Money cents={varianceCostCents} /></div>
        )}
        {status === "submitted" && (
          canApprove ? (
            <>
              {uncounted > 0 && <p className="text-[12.5px] text-ink-400">{uncounted} product{uncounted === 1 ? " was" : "s were"} not counted and will stay as they are.</p>}
              <p className="text-[12.5px] text-ink-400">Approving adjusts stock to what was counted and records the missing value as a stock loss.</p>
              <Button disabled={pending} onClick={() => act(() => approveCount(stockTakeId))}>{pending ? "Working…" : "Approve and adjust stock"}</Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => cancelCount(stockTakeId))}>Reject — change nothing</Button>
            </>
          ) : (
            <p className="text-ink-600">Submitted. Waiting for the owner to review.</p>
          )
        )}
        {error && <p className="text-bad text-[13px]">{error}</p>}
      </div>
    </div>
  );
}
