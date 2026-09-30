"use client";

import { useState } from "react";

/** Shrinks the photo on the phone (max 1200px, JPEG) so uploads are quick on mobile data. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the photo."))), "image/jpeg", 0.85));
}

export function PhoneCamera({ token, productName }: { token: string; productName: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const b = await shrink(f);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upload() {
    if (!blob) return;
    setState("uploading");
    const form = new FormData();
    form.append("photo", blob, "photo.jpg");
    const res = await fetch(`/api/photo/${token}`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setState("idle");
      return setError(body.error ?? "Upload failed. Try again.");
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <div className="card p-6 grid gap-2 text-center">
        <div className="text-[40px]">✓</div>
        <h1 className="text-[18px] font-semibold">Photo saved</h1>
        <p className="text-[14px] text-ink-600">It's on {productName} now. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="card p-5 grid gap-4">
      <div>
        <p className="text-[13px] text-ink-400">Photo for</p>
        <h1 className="text-[18px] font-semibold leading-snug">{productName}</h1>
      </div>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Photo preview" className="w-full rounded-xl bg-ink-50 object-contain max-h-[50vh]" />
      ) : (
        <p className="text-[14px] text-ink-600">Put the product on a plain background, front label facing you.</p>
      )}
      <label className="h-14 rounded-xl border border-ink-200 grid place-items-center text-[16px] font-medium cursor-pointer bg-white">
        {preview ? "Retake" : "Take photo"}
        <input type="file" accept="image/*" capture="environment" onChange={onPick} className="sr-only" />
      </label>
      {preview && (
        <button onClick={upload} disabled={state === "uploading"} className="h-14 rounded-xl bg-brand text-brand-ink text-[16px] font-semibold disabled:opacity-50">
          {state === "uploading" ? "Saving…" : "Use this photo"}
        </button>
      )}
      {error && <p role="alert" className="text-bad text-[14px]">{error}</p>}
    </div>
  );
}
