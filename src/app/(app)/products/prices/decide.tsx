"use client";

import { useState, useTransition } from "react";
import { decidePrice } from "../edit-actions";

export function DecideButtons({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const go = (approve: boolean) => start(async () => { const r = await decidePrice(id, approve); if (!r.ok) setErr(r.error); });
  return (
    <span className="flex gap-2 justify-end items-center">
      <button disabled={pending} onClick={() => go(true)} className="h-8 px-3 rounded-md bg-brand text-brand-ink text-[12.5px] font-medium cursor-pointer">Approve</button>
      <button disabled={pending} onClick={() => go(false)} className="h-8 px-3 rounded-md border-[0.5px] border-ink-200 text-[12.5px] cursor-pointer">Reject</button>
      {err && <span className="text-bad text-[12px]">{err}</span>}
    </span>
  );
}
