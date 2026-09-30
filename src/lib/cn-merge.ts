import { twMerge } from "tailwind-merge";

/** Like cn(), but resolves conflicting Tailwind utilities (later wins) — the
 *  animated sidebar's parts set base classes that callers override. */
export function cnMerge(...inputs: Array<string | false | null | undefined>): string {
  return twMerge(inputs.filter(Boolean).join(" "));
}
