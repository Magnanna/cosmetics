/**
 * Magnific (Freepik) API client — server only. Key: MAGNIFIC_API_KEY.
 * Result URLs from Magnific are temporary (minutes), so callers download
 * the bytes straight away and keep them in our own storage.
 */

const BASE = "https://api.magnific.com/v1/ai";

export class MagnificError extends Error {}

export function magnificEnabled(): boolean {
  return !!process.env.MAGNIFIC_API_KEY;
}

function key(): string {
  const k = process.env.MAGNIFIC_API_KEY;
  if (!k) throw new MagnificError("Add MAGNIFIC_API_KEY to the environment to use studio photos and posters.");
  return k;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new MagnificError("Couldn't fetch the result from Magnific.");
  return Buffer.from(await res.arrayBuffer());
}

/** Pulls the first result URL out of the shapes Magnific/Freepik endpoints return. */
export function resultUrl(body: unknown): string | null {
  const b = (body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body) as Record<string, unknown> | null;
  if (!b) return null;
  for (const k of ["output_url", "high_resolution", "url", "preview_url", "preview"]) if (typeof b[k] === "string") return b[k] as string;
  for (const k of ["generated", "images"]) {
    const arr = b[k];
    if (Array.isArray(arr) && arr.length) {
      const first = arr[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object" && typeof (first as { url?: unknown }).url === "string") return (first as { url: string }).url;
    }
  }
  return null;
}

export function taskState(body: unknown): { id: string | null; status: string } {
  const b = (body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body) as Record<string, unknown> | null;
  return { id: typeof b?.task_id === "string" ? b.task_id : null, status: String(b?.status ?? "").toUpperCase() };
}

/** Cut-out of the product on a transparent background (PNG bytes). */
export async function removeBackground(imageUrl: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/beta/remove-background`, {
    method: "POST",
    headers: { "x-magnific-api-key": key(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, output_resolution: "full" }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new MagnificError(`Magnific couldn't remove the background (${res.status}).`);
  const url = resultUrl(body);
  if (!url) throw new MagnificError("Magnific returned no image.");
  return download(url);
}

export type Aspect = "square_1_1" | "social_story_9_16";

/** Text-to-image (Seedream 4): create a task, poll until done (≤ ~50 s), return the bytes. */
export async function generateImage(prompt: string, aspect: Aspect): Promise<Buffer> {
  const headers = { "x-magnific-api-key": key(), "Content-Type": "application/json" };
  const create = await fetch(`${BASE}/text-to-image/seedream-v4`, { method: "POST", headers, body: JSON.stringify({ prompt, aspect_ratio: aspect }), signal: AbortSignal.timeout(20_000) });
  const created = await create.json().catch(() => null);
  if (!create.ok) throw new MagnificError(`Magnific couldn't start the image (${create.status}).`);
  const { id } = taskState(created);
  if (!id) throw new MagnificError("Magnific returned no task.");
  const until = Date.now() + 50_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${BASE}/text-to-image/seedream-v4/${id}`, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => null);
    const { status } = taskState(body);
    if (status === "COMPLETED") {
      const url = resultUrl(body);
      if (!url) throw new MagnificError("Magnific finished without an image.");
      return download(url);
    }
    if (status === "FAILED" || status === "ERROR") throw new MagnificError("Magnific couldn't make the image. Try again.");
  }
  throw new MagnificError("Magnific is taking too long. Try again in a minute.");
}
