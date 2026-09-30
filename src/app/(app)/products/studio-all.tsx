"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { studioPending, studioPhoto } from "./edit-actions";
import { Button } from "@/components/ui";

/** Turns every plain product photo into a studio photo, one at a time, with progress. */
export function StudioAll() {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const running = state !== null && state.done + state.failed < state.total;
  async function go() {
    const ids = await studioPending();
    if (ids.length === 0) return setState({ done: 0, total: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    setState({ done, total: ids.length, failed });
    for (const id of ids) {
      const r = await studioPhoto(id).catch(() => ({ ok: false as const, error: "" }));
      if (r.ok) done++;
      else failed++;
      setState({ done, total: ids.length, failed });
    }
    router.refresh();
  }
  return (
    <div className="flex items-center gap-2">
      {state && (
        <span className="text-[12px] text-ink-400 tnum">
          {state.total === 0 ? "All photos are studio photos." : `${state.done} of ${state.total} done${state.failed ? ` · ${state.failed} failed` : ""}`}
        </span>
      )}
      <Button variant="secondary" onClick={go} disabled={running}>{running ? "Making studio photos…" : "Make all studio photos"}</Button>
    </div>
  );
}
