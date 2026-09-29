"use client";

import { useTransition } from "react";
import { setOfferActive } from "./actions";

export function PauseButton({ offerId, active }: { offerId: number; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => setOfferActive(offerId, !active))} className="text-[12.5px] text-ink-600 hover:text-ink-900 underline cursor-pointer">
      {active ? "Pause" : "Resume"}
    </button>
  );
}
