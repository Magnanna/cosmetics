import { brandCss } from "@/lib/brand";

/** Points the accent tokens at the shop's brand colour (nothing to do for the default). */
export function BrandStyle({ color }: { color: string | null | undefined }) {
  const css = brandCss(color); // only ever built from a validated #RRGGBB
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
