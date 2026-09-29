"use client";

import { useEffect } from "react";

/** Opens the print dialog once the receipt has rendered (browser fallback when not in the desktop app). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 150);
    return () => clearTimeout(t);
  }, []);
  return null;
}
