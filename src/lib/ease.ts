/** Shared motion constants used by the animated sidebar and related nav. */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 500,
  damping: 40,
} as const;

export const SPRING_PRESS = {
  type: "spring",
  stiffness: 600,
  damping: 35,
} as const;
