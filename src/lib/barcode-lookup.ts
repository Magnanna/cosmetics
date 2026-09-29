import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, barcodeLibrary } from "@/db";

export interface BarcodeInfo {
  code: string;
  name: string | null;
  brand: string | null;
  size: string | null;
  imageUrl: string | null;
  source: string;
}

const UA = "KenfriPOS/0.1 (cosmetics shop point of sale)";
/** How long a "not found anywhere" answer is trusted before asking the internet again. */
const MISS_TTL_DAYS = 30;

async function getJson(url: string, ms = 4000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

type Off = { status?: number; product?: { product_name?: string; brands?: string; quantity?: string; image_front_url?: string } };

async function openFacts(host: "openbeautyfacts" | "openfoodfacts", code: string): Promise<BarcodeInfo | null> {
  const j = (await getJson(`https://world.${host}.org/api/v2/product/${code}.json?fields=product_name,brands,quantity,image_front_url`)) as Off | null;
  const p = j?.status === 1 ? j.product : null;
  if (!p?.product_name) return null;
  return {
    code,
    name: p.product_name.trim(),
    brand: p.brands?.split(",")[0]?.trim() || null,
    size: p.quantity?.trim() || null,
    imageUrl: p.image_front_url || null,
    source: host,
  };
}

type Upc = { items?: { title?: string; brand?: string; size?: string; images?: string[] }[] };

async function upcItemDb(code: string): Promise<BarcodeInfo | null> {
  const j = (await getJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`)) as Upc | null;
  const it = j?.items?.[0];
  if (!it?.title) return null;
  return {
    code,
    name: it.title.trim(),
    brand: it.brand?.trim() || null,
    size: it.size?.trim() || null,
    imageUrl: it.images?.find((u) => u.startsWith("https://")) ?? null,
    source: "upcitemdb",
  };
}

/**
 * What is this barcode? Shared library first, then free online databases.
 * Results (including misses) are saved to the shared library.
 */
export async function lookupBarcode(code: string): Promise<BarcodeInfo | null> {
  if (!/^\d{6,14}$/.test(code)) return null;
  const [cached] = await db.select().from(barcodeLibrary).where(eq(barcodeLibrary.code, code)).limit(1);
  if (cached) {
    const fresh = Date.now() - cached.lookedUpAt.getTime() < MISS_TTL_DAYS * 86_400_000;
    if (cached.source !== "none") return { ...cached };
    if (fresh) return null;
  }

  const [beauty, food] = await Promise.all([openFacts("openbeautyfacts", code), openFacts("openfoodfacts", code)]);
  const found = beauty ?? food ?? (await upcItemDb(code));

  await db
    .insert(barcodeLibrary)
    .values(found ?? { code, source: "none" })
    .onConflictDoUpdate({
      target: barcodeLibrary.code,
      set: found ? { name: found.name, brand: found.brand, size: found.size, imageUrl: found.imageUrl, source: found.source, lookedUpAt: sql`now()` } : { lookedUpAt: sql`now()` },
      // Never overwrite a name a shop typed with an online guess.
      setWhere: sql`${barcodeLibrary.source} <> 'shop'`,
    });
  return found;
}

/** A shop named this barcode — that beats any online database. */
export async function teachBarcode(info: { code: string; name: string; brand: string | null; imageUrl: string | null }) {
  if (!/^\d{6,14}$/.test(info.code) || (info.code.length === 13 && /^2\d/.test(info.code))) return; // in-store codes mean nothing to other shops
  await db
    .insert(barcodeLibrary)
    .values({ ...info, source: "shop" })
    .onConflictDoUpdate({ target: barcodeLibrary.code, set: { name: info.name, brand: info.brand, imageUrl: sql`coalesce(${info.imageUrl}, ${barcodeLibrary.imageUrl})`, source: "shop", lookedUpAt: sql`now()` } });
}
