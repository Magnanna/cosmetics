"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ImagePlus, RefreshCw, Share2, X } from "lucide-react";
import { posterData, type PosterData } from "./actions";
import { brandPalette, mix } from "@/lib/brand";

type Format = "square" | "story";
const SIZE: Record<Format, [number, number]> = { square: [1080, 1080], story: [1080, 1920] };
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif`;
const kes = (c: number) => `KES ${Math.round(c / 100).toLocaleString("en-KE")}`;

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // our storage allows it; keeps the canvas exportable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number) {
  let size = max;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    size -= 4;
  } while (ctx.measureText(text).width > width && size > 20);
  return size + 4;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, "")}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function draw(canvas: HTMLCanvasElement, d: PosterData, format: Format) {
  const [W, H] = SIZE[format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const p = brandPalette(d.brandColor);
  const [backdrop, logo, ...imgs] = await Promise.all([
    d.backdropUrl ? load(d.backdropUrl) : Promise.resolve(null),
    d.logoUrl ? load(d.logoUrl) : Promise.resolve(null),
    ...d.products.map((x) => load(x.imageUrl)),
  ]);

  // Backdrop: Magnific scene (cover-fit) or a soft brand gradient.
  if (backdrop) {
    const s = Math.max(W / backdrop.width, H / backdrop.height);
    ctx.drawImage(backdrop, (W - backdrop.width * s) / 2, (H - backdrop.height * s) / 2, backdrop.width * s, backdrop.height * s);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(p.brand, "#ffffff", 0.1));
    g.addColorStop(0.6, "#ffffff");
    g.addColorStop(1, mix(p.brand, "#ffffff", 0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = 72;
  let y = format === "story" ? 150 : 70;

  // Logo (or shop name) in a white pill.
  if (logo) {
    const h = 96;
    const w = Math.min(420, (logo.width / logo.height) * h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRect(ctx, (W - w - 56) / 2, y - 14, w + 56, h + 28, 28);
    ctx.fill();
    ctx.drawImage(logo, (W - w) / 2, y, w, h);
    y += h + 60;
  } else {
    ctx.fillStyle = p.brand700;
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(d.shopName.toUpperCase(), W / 2, y + 40);
    y += 100;
  }

  // Headline — the offer, exact.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const hs = fitText(ctx, d.headline, 800, format === "story" ? 150 : 124, W - pad * 2);
  ctx.fillStyle = p.brand;
  ctx.fillText(d.headline, W / 2, y);
  y += hs + 18;

  ctx.fillStyle = "#1d1d1f";
  ctx.font = `600 ${format === "story" ? 56 : 48}px ${FONT}`;
  for (const line of wrap(ctx, d.title, W - pad * 2, 2)) {
    ctx.fillText(line, W / 2, y);
    y += format === "story" ? 66 : 56;
  }
  if (d.description) {
    ctx.fillStyle = "#515154";
    ctx.font = `400 ${format === "story" ? 38 : 32}px ${FONT}`;
    for (const line of wrap(ctx, d.description, W - pad * 2, 2)) {
      ctx.fillText(line, W / 2, y + 8);
      y += format === "story" ? 48 : 40;
    }
  }

  // Products along the lower part, with the offer price under each.
  const footerH = 120;
  const top = y + (format === "story" ? 90 : 40);
  const bottom = H - footerH - 40;
  const items = d.products.map((x, i) => ({ ...x, img: imgs[i] })).filter((x) => x.img);
  if (items.length) {
    const slotW = (W - pad * 2) / items.length;
    const priceH = 110;
    const boxH = Math.max(160, bottom - top - priceH);
    items.forEach((it, i) => {
      const img = it.img!;
      const maxW = slotW - 36;
      const s = Math.min(maxW / img.width, boxH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      const cx = pad + slotW * i + slotW / 2;
      const iy = top + boxH - h;
      if (it.cutout) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.18)";
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 18;
        ctx.drawImage(img, cx - w / 2, iy, w, h);
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.12)";
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, cx - w / 2 - 14, iy - 14, w + 28, h + 28, 28);
        ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, cx - w / 2, iy, w, h, 18);
        ctx.clip();
        ctx.drawImage(img, cx - w / 2, iy, w, h);
        ctx.restore();
      }
      // Price tag
      const py = top + boxH + 26;
      ctx.textAlign = "center";
      if (it.offerPriceCents !== null && it.priceCents > 0 && it.offerPriceCents < it.priceCents) {
        ctx.font = `500 30px ${FONT}`;
        ctx.fillStyle = "#86868b";
        const was = kes(it.priceCents);
        ctx.fillText(was, cx, py);
        const ww = ctx.measureText(was).width;
        ctx.fillRect(cx - ww / 2, py + 17, ww, 3);
        ctx.font = `800 44px ${FONT}`;
        ctx.fillStyle = p.brand;
        ctx.fillText(kes(it.offerPriceCents), cx, py + 38);
      } else if (it.priceCents > 0) {
        ctx.font = `800 44px ${FONT}`;
        ctx.fillStyle = p.brand;
        ctx.fillText(kes(it.priceCents), cx, py + 20);
      }
    });
  }

  // Footer band in the brand colour.
  ctx.fillStyle = p.brand;
  ctx.fillRect(0, H - footerH, W, footerH);
  ctx.fillStyle = p.brandInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const until = new Date(d.endsAt).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "long" });
  const footer = [`Until ${until}`, d.shopName, d.shopPhone ? d.shopPhone.replace(/^254/, "0") : null].filter(Boolean).join("  ·  ");
  fitText(ctx, footer, 600, 36, W - pad * 2);
  ctx.fillText(footer, W / 2, H - footerH / 2);
}

/** "Make a poster" for an offer: Instagram post or WhatsApp status, ready to download or share. */
export function PosterMaker({ offerId, offerTitle, magnific }: { offerId: number; offerTitle: string; magnific: boolean }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("square");
  const [data, setData] = useState<PosterData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchData = useCallback(async (fmt: Format, fresh: boolean) => {
    setError(null);
    setBusy(fresh ? "Making a new backdrop with Magnific…" : magnific ? "Preparing the poster (first time takes ~30 s)…" : "Preparing the poster…");
    const r = await posterData(offerId, fmt, fresh);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setData(r.data);
  }, [offerId, magnific]);

  useEffect(() => {
    if (open) fetchData(format, false);
  }, [open, format, fetchData]);

  useEffect(() => {
    if (data && canvasRef.current) draw(canvasRef.current, data, format).catch(() => setError("Couldn't draw the poster."));
  }, [data, format]);

  const fileName = `${offerTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${format === "square" ? "post" : "status"}.png`;
  const blob = () => new Promise<Blob | null>((r) => canvasRef.current?.toBlob(r, "image/png"));

  async function download() {
    const b = await blob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function share() {
    const b = await blob();
    if (!b) return;
    const file = new File([b], fileName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: offerTitle }).catch(() => {});
    else download();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline cursor-pointer">
        <ImagePlus aria-hidden="true" className="size-3.5" /> Make a poster
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !busy && setOpen(false)}>
          <div className="card rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-[zeno-pop_0.18s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 hairline-b">
              <h2 className="text-[14px] font-semibold">Poster · {offerTitle}</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="size-7 grid place-items-center rounded-full text-ink-400 hover:bg-ink-50 cursor-pointer"><X aria-hidden="true" className="size-4" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-5 grid gap-4 md:grid-cols-[1fr_220px]">
              <div className="grid place-items-center bg-ink-50 rounded-xl border border-ink-100 p-3 min-h-[320px]">
                {busy ? <p className="text-[13px] text-ink-400 text-center">{busy}</p> : <canvas ref={canvasRef} className={`max-w-full rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.12)] ${format === "square" ? "max-h-[62vh] aspect-square" : "max-h-[62vh] aspect-[9/16]"}`} />}
              </div>
              <div className="grid gap-3 content-start">
                <div className="grid grid-cols-2 gap-1 rounded-full bg-white border border-ink-200 p-1">
                  {(["square", "story"] as Format[]).map((f) => (
                    <button key={f} disabled={!!busy} onClick={() => setFormat(f)} className={`h-8 rounded-full text-[12.5px] cursor-pointer transition-colors ${format === f ? "bg-brand text-brand-ink font-medium" : "text-ink-600 hover:text-ink-900"}`}>
                      {f === "square" ? "Instagram post" : "WhatsApp status"}
                    </button>
                  ))}
                </div>
                <button disabled={!!busy || !data} onClick={share} className="h-10 rounded-lg bg-brand text-brand-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 cursor-pointer disabled:opacity-50"><Share2 aria-hidden="true" className="size-4" /> Share</button>
                <button disabled={!!busy || !data} onClick={download} className="h-10 rounded-lg bg-white border border-ink-200 text-[13px] font-medium text-ink-600 inline-flex items-center justify-center gap-2 hover:bg-ink-50 cursor-pointer disabled:opacity-50"><Download aria-hidden="true" className="size-4" /> Download PNG</button>
                {magnific && (
                  <button disabled={!!busy} onClick={() => fetchData(format, true)} className="h-9 rounded-lg text-[12.5px] text-brand-700 font-medium inline-flex items-center justify-center gap-1.5 hover:bg-brand-wash cursor-pointer disabled:opacity-50"><RefreshCw aria-hidden="true" className="size-3.5" /> New backdrop</button>
                )}
                {error && <p className="text-bad text-[12.5px]">{error}</p>}
                <p className="text-[11.5px] text-ink-400">
                  {magnific ? "The backdrop is made by Magnific; the offer, prices and logo are added by Kenfri so they're always exact." : "Add the Magnific key for AI backdrops. Until then posters use your brand colours."}
                  {data && data.products.length === 0 && " No product photos in this offer yet — add photos to show products."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
