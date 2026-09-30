"use client";

import { motion } from "motion/react";
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cnMerge as cn } from "@/lib/cn-merge";

interface SharedLayoutBgProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Horizontal inset (px) of the hover pill inside the container. */
  inset?: number;
  pillClassName?: string;
  pillContainerClassName?: string;
  children?: ReactNode;
}

const ITEM_SELECTOR = "[data-slot='sidebar-menu-item']";

/**
 * A container whose hover pill slides between child items: tracks the
 * hovered `[data-slot="sidebar-menu-item"]` and animates one shared
 * background to its top/height, instead of each item painting its own hover.
 */
export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
  function SharedLayoutBg(
    { as: Tag = "div", inset = 0, pillClassName, pillContainerClassName, className, children, onPointerLeave, ...props },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLElement | null>(null);
    const [rect, setRect] = useState<{ top: number; height: number } | null>(null);

    const setRefs = useCallback(
      (node: HTMLElement | null) => {
        containerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) (forwardedRef as { current: HTMLElement | null }).current = node;
      },
      [forwardedRef],
    );

    const handleMove = (event: React.PointerEvent<HTMLElement>) => {
      const container = containerRef.current;
      if (!container || event.pointerType === "touch") return;
      const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
      if (!item || !container.contains(item)) {
        setRect(null);
        return;
      }
      setRect({ top: item.offsetTop, height: item.offsetHeight });
    };

    const Component = Tag as ElementType;
    return (
      <Component
        {...props}
        ref={setRefs as Ref<HTMLElement>}
        onPointerMove={handleMove}
        onPointerLeave={(event: React.PointerEvent<HTMLElement>) => {
          setRect(null);
          onPointerLeave?.(event);
        }}
        className={cn("relative", className)}
      >
        <div
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-x-0 top-0 z-0", pillContainerClassName)}
          style={{ left: inset, right: inset }}
        >
          <motion.div
            initial={false}
            animate={{
              opacity: rect ? 1 : 0,
              y: rect?.top ?? 0,
              height: rect?.height ?? 0,
            }}
            transition={{ ...SPRING_LAYOUT, opacity: { duration: 0.12 } }}
            className={cn("absolute inset-x-0 top-0", pillClassName)}
          />
        </div>
        {children}
      </Component>
    );
  },
);
