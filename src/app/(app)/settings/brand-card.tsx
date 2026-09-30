"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus } from "lucide-react";
import { saveBrand } from "./actions";
import { Button } from "@/components/ui";
import { BRAND_PRESETS, brandPalette, isHexColor } from "@/lib/brand";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/** Shrinks the picked logo in the browser (max 800px, PNG keeps transparency) so uploads stay small. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file couldn't be opened as an image."));
      i.src = url;
    });
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the logo."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandCard({ shopName, logoUrl, brandColor }: { shopName: string; logoUrl: string | null; brandColor: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(brandColor.toUpperCase());
  const [hexDraft, setHexDraft] = useState(brandColor.toUpperCase());
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [removed, setRemoved] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();

  const p = brandPalette(color);
  const vars = {
    "--color-brand": p.brand, "--color-brand-600": p.brand600, "--color-brand-700": p.brand700, "--color-brand-ink": p.brandInk,
    "--color-brand-tint": p.brandTint, "--color-brand-wash": p.brandWash, "--color-brand-ring": p.brandRing,
  } as CSSProperties;
  const dirty = color !== brandColor.toUpperCase() || blob !== null || removed;

  async function pick(file: File | undefined) {
    setMsg({});
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setMsg({ error: "Use a PNG, JPG or WebP logo. A PNG with a transparent background looks best." });
    try {
      const b = await shrink(file);
      setBlob(b);
      setRemoved(false);
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  }

  function save() {
    setMsg({});
    const fd = new FormData();
    fd.set("brandColor", color);
    if (blob) fd.set("logo", new File([blob], "logo.png", { type: "image/png" }));
    if (removed) fd.set("removeLogo", "1");
    start(async () => {
      const r = await saveBrand(fd);
      setMsg(r);
      if (r.ok) {
        setBlob(null);
        setRemoved(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="card p-5 grid gap-5 max-w-2xl" style={vars}>
      <div>
        <h2 className="text-[13.5px] font-semibold">Brand</h2>
        <p className="text-[12.5px] text-ink-400 mt-0.5">Your logo shows in the menu, on the till and on every receipt — printed and online. The colour is used for buttons and highlights across the system.</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-[auto_1fr] items-start">
        {/* Logo */}
        <div className="grid gap-2 justify-items-center">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={preview ? "Change logo" : "Add logo"}
            className="relative w-24 h-24 rounded-xl border-2 border-dashed border-ink-200 hover:border-brand flex items-center justify-center transition-colors overflow-hidden bg-ink-50 group cursor-pointer"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Logo" className="w-full h-full object-contain p-2 bg-white" />
            ) : (
              <span className="grid justify-items-center gap-1 text-ink-400 group-hover:text-brand-700 transition-colors">
                <ImagePlus aria-hidden="true" className="size-6" strokeWidth={1.6} />
                <span className="text-[11px] font-medium">Add logo</span>
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT.join(",")} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          {preview && (
            <div className="flex gap-3 text-[12px]">
              <button type="button" onClick={() => fileRef.current?.click()} className="text-brand-700 font-medium hover:underline cursor-pointer">Change</button>
              <button type="button" onClick={() => { setPreview(null); setBlob(null); setRemoved(true); }} className="text-ink-400 hover:text-bad cursor-pointer">Remove</button>
            </div>
          )}
          <p className="text-[11px] text-ink-400 text-center max-w-[120px]">PNG with a clear background works best</p>
        </div>

        {/* Colour */}
        <div className="grid gap-3">
          <span className="text-[12px] font-medium text-ink-600">Brand colour</span>
          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((b) => {
              const on = b.hex.toUpperCase() === color;
              return (
                <button
                  key={b.hex}
                  type="button"
                  title={b.name}
                  aria-label={b.name}
                  aria-pressed={on}
                  onClick={() => { setColor(b.hex.toUpperCase()); setHexDraft(b.hex.toUpperCase()); }}
                  className={`size-9 rounded-full grid place-items-center transition-all cursor-pointer ${on ? "ring-2 ring-offset-2 ring-ink-900" : "hover:scale-110"}`}
                  style={{ background: b.hex }}
                >
                  {on && <Check aria-hidden="true" className="size-4" style={{ color: brandPalette(b.hex).brandInk }} />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value.toUpperCase()); setHexDraft(e.target.value.toUpperCase()); }}
              className="h-9 w-12 rounded-lg border border-ink-200 bg-white cursor-pointer p-1"
              aria-label="Custom brand colour"
            />
            <input
              value={hexDraft}
              onChange={(e) => {
                const v = e.target.value.trim().toUpperCase();
                setHexDraft(v);
                const withHash = v.startsWith("#") ? v : `#${v}`;
                if (isHexColor(withHash)) setColor(withHash);
              }}
              maxLength={7}
              spellCheck={false}
              aria-label="Brand colour hex code"
              className="h-9 w-28 rounded-lg border border-ink-200 bg-white px-3 text-[13px] tnum uppercase outline-none focus:border-brand-ring focus:ring-2 focus:ring-brand-tint"
            />
          </div>

          {/* Live preview */}
          <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 grid gap-3 sm:grid-cols-[1fr_auto] items-center">
            <div className="grid gap-2 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="size-10 shrink-0 rounded-xl bg-white border border-ink-100 shadow-[0_1px_3px_rgba(0,0,0,0.12)] grid place-items-center overflow-hidden">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="w-full h-full object-contain p-1" />
                  ) : (
                    <span className="text-[17px] font-bold text-brand">{shopName.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <span className="text-[13px] font-semibold truncate">{shopName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-8 px-3 rounded-lg bg-brand text-brand-ink text-[12.5px] font-medium grid place-items-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">Checkout</span>
                <span className="h-8 px-3 rounded-lg bg-white/80 text-brand-700 text-[12.5px] font-medium grid place-items-center shadow-[0_1px_2px_rgba(0,0,0,0.05)]">Active menu item</span>
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-brand-wash text-brand-700 border-brand-tint">Offer</span>
              </div>
            </div>
            {/* Printed receipt header (black and white on thermal paper) */}
            <div className="w-36 justify-self-center bg-white border border-ink-200 rounded-md px-3 py-2.5 grid justify-items-center gap-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="max-h-10 max-w-full object-contain grayscale contrast-150" />
              )}
              <span className="text-[10px] font-bold text-black truncate max-w-full">{shopName}</span>
              <span className="h-px w-full border-t border-dashed border-black/60" />
              <span className="text-[8px] text-black/60">Printed receipt</span>
            </div>
          </div>
        </div>
      </div>

      {msg.error && <p className="text-bad text-[13px]">{msg.error}</p>}
      {msg.ok && <p className="text-good text-[13px]">{msg.ok}</p>}
      <div>
        <Button type="button" onClick={save} disabled={pending || !dirty}>{pending ? "Saving…" : "Save brand"}</Button>
      </div>
    </section>
  );
}
