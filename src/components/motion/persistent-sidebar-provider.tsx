"use client";

import { useEffect, useState } from "react";
import {
  AnimatedSidebarProvider,
  type AnimatedSidebarProviderProps,
} from "@/components/motion/animated-sidebar";

/**
 * AnimatedSidebarProvider that remembers expanded/collapsed per browser.
 * The stored value is applied in an effect after mount (not during the
 * first render) so server and client markup match and hydration stays clean.
 */
export function PersistentSidebarProvider({
  storageKey,
  children,
  ...props
}: AnimatedSidebarProviderProps & { storageKey: string }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "collapsed") setOpen(false);
    } catch {
      /* storage blocked — stay expanded */
    }
  }, [storageKey]);

  return (
    <AnimatedSidebarProvider
      {...props}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        try {
          localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
        } catch {
          /* ignore */
        }
      }}
    >
      {children}
    </AnimatedSidebarProvider>
  );
}
