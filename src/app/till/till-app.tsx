"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { completeSale, customerUsual, lookupCustomer, parkSale, parkedList, quickCreateCustomer, startShift, type ParkedCart, type TillCustomer } from "./actions";
import { MoreMenu, ParkedSales, PinPrompt, SwitchUser, type ExchangeCredit } from "./till-dialogs";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, Minus, PauseCircle, Phone, Plus, Printer, ScanBarcode, Search, Trash2, X } from "lucide-react";
import { applyOffers, type OfferDef } from "@/lib/offers";
import { fmtPoints } from "@/lib/loyalty";
import { choosePrinter, inDesktopApp, listPrinters, openDrawer, printReceipt, printTestPage } from "@/lib/print-client";
import { parseKES } from "@/lib/money";
import { normalizeKenyanPhone } from "@/lib/phone";
import { parseCardNumber } from "@/lib/card";
import { ShopMark } from "@/components/sidebar";
import type { Role } from "@/lib/context";
import type { UsualItem } from "@/lib/usual";

export interface TillVariant {
  id: number;
  label: string;
  retailCents: number;
  wholesaleCents: number;
  swatchHex: string | null;
  barcodes: string[];
  onHand: number;
}

export interface TillProduct {
  id: number;
  name: string;
  brand: string | null;
  brandId: number | null;
  imageUrl: string | null;
  topCategoryId: number | null;
  /** The product's category and its parent, for offers. */
  categoryIds: number[];
  optionNames: string[];
  variants: TillVariant[];
}

interface CartLine {
  variantId: number;
  productName: string;
  label: string;
  qty: number;
  discountCents: number;
}

type Tender = { method: "cash" | "mpesa" | "credit" | "points" | "exchange"; amountCents: number; tenderedCents?: number; mpesaCode?: string; returnId?: number };

const kes = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-KE")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function TillApp(props: {
  shopName: string;
  logoUrl: string | null;
  cashierName: string;
  role: Role;
  registerId: number | null;
  registerName: string;
  shiftOpen: boolean;
  discountLimitCents: number;
  products: TillProduct[];
  categories: { id: number; name: string }[];
  offers: OfferDef[];
  expenseAccounts: { code: string; name: string }[];
}) {
  const [shiftOpen, setShiftOpen] = useState(props.shiftOpen);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [picker, setPicker] = useState<TillProduct | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<TillCustomer | null>(null);
  const [cartDiscountCents, setCartDiscountCents] = useState(0);
  /** Owner PIN typed to approve a discount above the cashier limit (checked again on the server). */
  const [ownerPin, setOwnerPin] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeCredit | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showParked, setShowParked] = useState(false);
  const [parkedCount, setParkedCount] = useState(0);
  const router = useRouter();
  const refreshParked = useCallback(() => {
    if (props.registerId) parkedList(props.registerId).then((r) => r.ok && setParkedCount(r.data.length));
  }, [props.registerId]);
  useEffect(() => { refreshParked(); }, [refreshParked]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ receiptNo: string; receiptToken: string; changeCents: number; totalCents: number; pointsEarned: number; pointsBalance: number | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const variantIndex = useMemo(() => {
    const byId = new Map<number, { product: TillProduct; variant: TillVariant }>();
    const byCode = new Map<string, { product: TillProduct; variant: TillVariant }>();
    for (const p of props.products)
      for (const v of p.variants) {
        byId.set(v.id, { product: p, variant: v });
        for (const c of v.barcodes) byCode.set(c, { product: p, variant: v });
      }
    return { byId, byCode };
  }, [props.products]);

  const wholesale = customer?.type === "wholesale";
  const priceOf = useCallback((v: TillVariant) => (wholesale && v.wholesaleCents > 0 ? v.wholesaleCents : v.retailCents), [wholesale]);

  const addVariant = useCallback(
    (p: TillProduct, v: TillVariant, qty = 1) => {
      if (priceOf(v) <= 0) {
        setToast(`${p.name}${v.label ? ` · ${v.label}` : ""} has no approved price yet.`);
        return;
      }
      setCart((c) => {
        const i = c.findIndex((l) => l.variantId === v.id);
        if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
        return [...c, { variantId: v.id, productName: p.name, label: v.label, qty, discountCents: 0 }];
      });
      if (v.onHand <= 0) setToast(`Heads up: the system shows no ${p.name} in stock. Sale allowed — check the shelf count.`);
    },
    [priceOf]
  );

  // A scanned loyalty card picks the customer instead of adding a product.
  const pickCardCustomer = useCallback((code: string) => {
    if (!parseCardNumber(code)) return false;
    lookupCustomer(code).then((r) => {
      if (r.ok && r.data) { setCustomer(r.data); setToast(`${r.data.businessName || r.data.name || "Customer"} — card scanned.`); }
      else setToast("That loyalty card isn't from this shop.");
    });
    return true;
  }, []);

  const addByBarcode = useCallback(
    (code: string) => {
      if (pickCardCustomer(code)) return true;
      const hit = variantIndex.byCode.get(code.trim());
      if (!hit) {
        setToast(`Barcode ${code} not found — search by name or tell a staff member.`);
        return false;
      }
      addVariant(hit.product, hit.variant);
      return true;
    },
    [variantIndex, addVariant, pickCardCustomer]
  );

  // Barcode scanners type fast and end with Enter. Catch scans anywhere on the till except text fields other than search.
  useEffect(() => {
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (paying || picker || !shiftOpen) return;
      const target = e.target as HTMLElement;
      const inOtherField = (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && target !== searchRef.current;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "F4") { e.preventDefault(); phoneRef.current?.focus(); return; }
      if (e.key === "F8") { e.preventDefault(); (Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Park sale")) as HTMLButtonElement | undefined)?.click(); return; }
      if (inOtherField) return;
      const now = performance.now();
      if (now - last > 60) buffer = "";
      last = now;
      if (e.key === "Enter") {
        if (buffer.length >= 6 && target !== searchRef.current) {
          e.preventDefault();
          addByBarcode(buffer);
        }
        buffer = "";
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addByBarcode, paying, picker, shiftOpen]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.products.filter((p) => {
      if (category && p.topCategoryId !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        p.variants.some((v) => v.label.toLowerCase().includes(q) || v.barcodes.some((b) => b.includes(q)))
      );
    });
  }, [props.products, query, category]);

  // Same offers engine as the server, so the price on screen is the price charged.
  const offerResult = applyOffers(
    cart.map((l) => {
      const { product, variant } = variantIndex.byId.get(l.variantId)!;
      return { variantId: variant.id, productId: product.id, brandId: product.brandId, categoryIds: product.categoryIds, unitCents: priceOf(variant), qty: l.qty };
    }),
    props.offers,
    wholesale ? "wholesale" : "retail",
    clock
  );
  const lines = cart.map((l, i) => {
    const entry = variantIndex.byId.get(l.variantId)!;
    const unit = priceOf(entry.variant);
    const promo = offerResult.lines[i].promoDiscountCents;
    return { ...l, unit, gross: unit * l.qty, promo, offerTitle: offerResult.lines[i].offerTitle, net: unit * l.qty - promo - l.discountCents };
  });
  const grossCents = lines.reduce((s, l) => s + l.gross, 0);
  const promoCents = lines.reduce((s, l) => s + l.promo, 0);
  const lineDiscounts = lines.reduce((s, l) => s + l.discountCents, 0);
  const totalCents = grossCents - promoCents - lineDiscounts - cartDiscountCents;
  const units = lines.reduce((s, l) => s + l.qty, 0);

  function resetSale() {
    setCart([]);
    setCustomer(null);
    setCartDiscountCents(0);
    setOwnerPin(null);
    setExchange(null);
    setDone(null);
    setQuery("");
    searchRef.current?.focus();
  }

  if (!props.registerId) {
    return <Blocking title="No till set up" body="Run the seed to create Till 1." />;
  }
  if (!shiftOpen) {
    return <OpenShift shopName={props.shopName} logoUrl={props.logoUrl} registerId={props.registerId} registerName={props.registerName} cashierName={props.cashierName} onOpened={() => setShiftOpen(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-ink-50 text-ink-900 select-none">
      <header className="shrink-0 px-3 pt-3">
        <div className="sidebar-chrome rounded-2xl border border-ink-100/70 shadow-[0_2px_14px_rgba(0,0,0,0.06)] h-16 flex items-center justify-between gap-3 pl-2.5 pr-2 text-[13px]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 size-11 rounded-xl overflow-hidden flex items-center justify-center bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] border border-ink-100">
            <ShopMark shopName={props.shopName} logoUrl={props.logoUrl} className="text-[18px]" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="text-[13.5px] font-semibold tracking-tight truncate">{props.shopName}</div>
            <div className="text-[10.5px] text-ink-400 mt-0.5 truncate">{props.registerName}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-ink-600">
          <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 mr-1 rounded-full text-[11px] font-medium border ${online ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`} />
            {online ? "Online" : "Offline — sales can't be saved"}
          </span>
          <MoreMenu
            registerId={props.registerId}
            role={props.role}
            customer={customer}
            expenseAccounts={props.expenseAccounts}
            onMessage={setToast}
            onCustomerChanged={setCustomer}
            onShiftClosed={() => { resetSale(); setShiftOpen(false); }}
            onExchange={(credit, c) => { resetSale(); setCustomer(c); setExchange(credit); setToast(`Exchange credit KES ${kes(credit.creditLeftCents)} ready — add the new items.`); }}
            onReprint={(token) => printReceipt(token, false, true).then(() => setToast("Reprint sent.")).catch((e) => setToast(`Receipt didn't print: ${e.message}`))}
          />
          <PrinterMenu shopName={props.shopName} onMessage={setToast} />
          {parkedCount > 0 && (
            <button onClick={() => setShowParked(true)} className={`${TOOL} text-brand-700 font-medium`}>
              <PauseCircle aria-hidden="true" className="size-4" />
              Parked
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-brand text-brand-ink text-[11px] font-semibold grid place-items-center tnum">{parkedCount}</span>
            </button>
          )}
          <button onClick={() => setSwitching(true)} className={`${TOOL} pl-1.5`} title="Switch who is using the till">
            <span className="size-7 rounded-full bg-brand text-brand-ink grid place-items-center text-[11.5px] font-semibold">{props.cashierName.slice(0, 1).toUpperCase()}</span>
            <span className="hidden sm:inline text-ink-900 font-medium">{props.cashierName}</span>
            <span className="text-ink-400">Switch</span>
          </button>
          {props.role !== "cashier" && (
            <Link href="/" className="ml-1 h-9 px-3.5 rounded-full bg-white border border-ink-200 text-ink-600 hover:text-ink-900 hover:bg-ink-50 inline-flex items-center gap-1.5 font-medium transition-colors">
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">Back office</span>
            </Link>
          )}
        </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        {/* Products */}
        <section className="min-h-0 flex flex-col p-3 pt-4 lg:pl-4 gap-3">
          <div className="relative flex items-center shrink-0">
          <Search aria-hidden="true" className="absolute left-4 size-4 text-ink-400 pointer-events-none" />
          <input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                if (pickCardCustomer(query.trim())) { setQuery(""); return; }
                const exact = variantIndex.byCode.get(query.trim());
                if (exact) { addVariant(exact.product, exact.variant); setQuery(""); }
                else if (visible.length === 1 && visible[0].variants.length === 1) { addVariant(visible[0], visible[0].variants[0]); setQuery(""); }
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search name, brand or shade — or scan a barcode (F2)"
            className="h-12 w-full rounded-full bg-white pl-11 pr-12 text-[14.5px] border border-ink-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] placeholder:text-ink-400 transition-all focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint select-text"
          />
          <ScanBarcode aria-hidden="true" className="absolute right-4 size-4.5 text-ink-400 pointer-events-none" />
          </div>
          <div className="flex gap-0.5 overflow-x-auto shrink-0 self-start max-w-full rounded-full bg-white border border-ink-200 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Chip on={category === null} onClick={() => setCategory(null)}>All</Chip>
            {props.categories.map((c) => (
              <Chip key={c.id} on={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="card text-[13.5px] text-ink-400 p-10 text-center">{props.products.length === 0 ? "No products yet — add them in the back office." : "Nothing matches that search."}</p>
            ) : (
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] pb-3">
                {visible.map((p) => {
                  const prices = p.variants.map(priceOf).filter((c) => c > 0);
                  const min = prices.length ? Math.min(...prices) : 0;
                  const swatches = p.variants.filter((v) => v.swatchHex).slice(0, 5);
                  return (
                    <button
                      key={p.id}
                      onClick={() => (p.variants.length === 1 ? addVariant(p, p.variants[0]) : setPicker(p))}
                      className="card text-left p-3 grid gap-2 content-start min-h-[120px] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)] hover:border-ink-200 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                    >
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" loading="lazy" className="h-20 w-full rounded-lg object-contain bg-ink-50" />
                      ) : (
                      <div className="h-10 rounded-lg flex overflow-hidden bg-ink-50">
                        {swatches.length > 0 ? swatches.map((v) => <span key={v.id} className="flex-1" style={{ background: v.swatchHex! }} />) : <span className="flex-1 grid place-items-center text-[11px] text-ink-400">{p.brand ?? ""}</span>}
                      </div>
                      )}
                      <span className="text-[13px] font-medium leading-snug line-clamp-2">{p.name}</span>
                      <span className="text-[11.5px] text-ink-400 tnum">
                        {p.variants.length > 1 ? `${p.variants.length} ${p.optionNames[0]?.toLowerCase() ?? "options"} · from ` : ""}
                        <span className={min > 0 ? "text-[13px] font-semibold text-ink-900" : ""}>{min > 0 ? kes(min) : "No price"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cart */}
        <aside className="min-h-0 flex flex-col card rounded-2xl m-3 lg:ml-1 lg:mt-4 overflow-hidden">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h2 className="text-[13.5px] font-semibold">Current sale</h2>
            <span className="text-[11.5px] text-ink-400 tnum">{units} item{units === 1 ? "" : "s"}</span>
          </div>
          <CustomerSlot customer={customer} onChange={(c) => { setCustomer(c); if (!c || c.id !== exchange?.customerId) setExchange(null); }} phoneRef={phoneRef} />
          {customer && (
            <UsualStrip
              customerId={customer.id}
              inCart={new Set(cart.map((l) => l.variantId))}
              resolve={(id) => variantIndex.byId.get(id)}
              priceOf={priceOf}
              onAdd={(p, v, qty) => addVariant(p, v, qty)}
            />
          )}
          {exchange && (
            <div className="mx-5 mb-2 rounded-lg bg-brand-wash border border-brand-tint px-3 py-2 text-[12.5px] flex justify-between">
              <span>Exchange credit from {exchange.returnNo}</span>
              <span className="tnum font-semibold">KES {kes(exchange.creditLeftCents)}</span>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-5">
            {lines.length === 0 ? (
              <div className="grid justify-items-center gap-2 text-center py-12">
                <span className="size-11 rounded-full bg-ink-50 border border-ink-100 grid place-items-center text-ink-400"><ScanBarcode aria-hidden="true" className="size-5" /></span>
                <p className="text-[12.5px] text-ink-400">Scan or tap a product to start.</p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {lines.map((l) => (
                  <li key={l.variantId} className="py-3 grid gap-2 animate-[zeno-pop_0.18s_ease-out]">
                    <div className="flex justify-between gap-3 text-[13px]">
                      <span className="font-medium leading-snug">{l.productName}{l.label && <span className="text-ink-400 font-normal"> · {l.label}</span>}</span>
                      <span className="tnum whitespace-nowrap font-semibold">
                        {l.promo > 0 && <s className="text-ink-400 font-normal mr-1.5">{kes(l.gross)}</s>}
                        {kes(l.net)}
                      </span>
                    </div>
                    {l.offerTitle && <span className="justify-self-start inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border bg-brand-wash text-brand-700 border-brand-tint">{l.offerTitle}</span>}
                    <div className="flex items-center justify-between gap-2 text-[12.5px] text-ink-600">
                      <div className="flex items-center gap-1">
                        <QtyButton label="Less" onClick={() => setCart((c) => c.flatMap((x) => (x.variantId !== l.variantId ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1, discountCents: Math.min(x.discountCents, (x.qty - 1) * l.unit) }] : [])))} />
                        <span className="w-8 text-center tnum text-[14px] font-medium text-ink-900">{l.qty}</span>
                        <QtyButton label="More" onClick={() => setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x)))} />
                        <span className="ml-2 tnum text-ink-400">× {kes(l.unit)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {l.discountCents > 0 && <span className="text-brand-700 tnum">−{kes(l.discountCents)}</span>}
                        <button aria-label="Remove" title="Remove" className="size-8 rounded-full grid place-items-center text-ink-400 hover:text-bad hover:bg-red-50 transition-colors cursor-pointer" onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))}><X aria-hidden="true" className="size-4" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-ink-100 bg-ink-50/60 px-5 pt-4 pb-5 grid gap-2.5">
            <div className="flex justify-between text-[12.5px] text-ink-600">
              <span>Subtotal <span className="tnum text-ink-900">{kes(grossCents)}</span></span>
              <DiscountButton
                currentCents={cartDiscountCents}
                maxCents={grossCents - promoCents - lineDiscounts}
                limitCents={props.role === "owner" ? null : props.discountLimitCents}
                onSet={(c, pin) => { setCartDiscountCents(c); setOwnerPin(pin); }}
              />
            </div>
            {promoCents > 0 && (
              <div className="flex justify-between text-[13px] text-brand-700"><span>Offers</span><span className="tnum">−{kes(promoCents)}</span></div>
            )}
            {cartDiscountCents + lineDiscounts > 0 && (
              <div className="flex justify-between text-[13px] text-brand-700"><span>Discount{ownerPin ? " · owner approved" : ""}</span><span className="tnum">−{kes(cartDiscountCents + lineDiscounts)}</span></div>
            )}
            {customer?.earnsPoints && offerResult.bonusOffers.map((b) => (
              <div key={b.id} className="flex justify-between text-[12.5px] text-good"><span>{b.title}</span><span className="tnum">+{fmtPoints(b.centipoints)} pts</span></div>
            ))}
            <div className="flex justify-between items-end pt-1">
              <div className="grid">
                <span className="text-[12.5px] font-medium text-ink-400">Total (KES)</span>
                {wholesale && <span className="justify-self-start mt-1 inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border bg-amber-50 text-amber-700 border-amber-200">Wholesale prices</span>}
              </div>
              <span className="text-[32px] font-semibold tracking-tight tnum leading-none">{kes(totalCents)}</span>
            </div>
            <button
              disabled={lines.length === 0 || !customer || totalCents <= 0}
              onClick={() => setPaying(true)}
              className="h-14 mt-1 rounded-xl bg-brand text-brand-ink text-[16px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_rgba(90,33,50,0.18)] disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed cursor-pointer hover:bg-brand-600 active:scale-[0.99] transition-all duration-200"
            >
              {!customer && lines.length > 0 ? "Add the customer's phone to check out" : "Checkout"}
            </button>
            {lines.length > 0 && (
              <div className="flex justify-between">
                <button
                  className="h-8 px-3 -ml-3 rounded-full inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-700 hover:bg-brand-wash transition-colors cursor-pointer"
                  onClick={async () => {
                    const label = customer ? customer.businessName || customer.name || customer.phoneMasked : "";
                    const cartData: ParkedCart = { lines: cart.map((l) => ({ variantId: l.variantId, qty: l.qty, discountCents: l.discountCents })), cartDiscountCents };
                    const r = await parkSale(props.registerId!, label, customer?.id ?? null, cartData);
                    if (!r.ok) return setToast(r.error);
                    resetSale();
                    refreshParked();
                    setToast("Sale parked. Take it back from “Parked” at the top.");
                  }}
                >
                  <PauseCircle aria-hidden="true" className="size-4" />
                  Park sale (F8)
                </button>
                <button className="h-8 px-3 -mr-3 rounded-full inline-flex items-center gap-1.5 text-[12.5px] text-ink-400 hover:text-bad hover:bg-red-50 transition-colors cursor-pointer" onClick={resetSale}>
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Clear sale
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {picker && <VariantPicker product={picker} priceOf={priceOf} onPick={(v) => { addVariant(picker, v); setPicker(null); }} onClose={() => setPicker(null)} />}
      {paying && customer && (
        <PaySheet
          totalCents={totalCents}
          customer={customer}
          exchange={exchange}
          onClose={() => setPaying(false)}
          submit={async (payments, idempotencyKey) => {
            const res = await completeSale({
              idempotencyKey,
              registerId: props.registerId!,
              customerId: customer.id,
              lines: cart.map((l) => ({ variantId: l.variantId, qty: l.qty, manualDiscountCents: l.discountCents })),
              cartDiscountCents,
              payments,
              ownerPin: ownerPin ?? undefined,
            });
            if (!res.ok) return res.error;
            setPaying(false);
            setDone({ receiptNo: res.data.receiptNo, receiptToken: res.data.receiptToken, changeCents: res.data.changeCents, totalCents: res.data.totalCents, pointsEarned: res.data.pointsEarned, pointsBalance: customer.earnsPoints ? res.data.pointsBalance : null });
            printReceipt(res.data.receiptToken, payments.some((p) => p.method === "cash")).catch((e) => setToast(`Receipt didn't print: ${e.message}`));
            return null;
          }}
        />
      )}
      {switching && <SwitchUser onClose={() => setSwitching(false)} onSwitched={(name) => { setSwitching(false); resetSale(); setToast(`${name} is now using the till.`); router.refresh(); }} />}
      {showParked && (
        <ParkedSales
          registerId={props.registerId}
          cartHasItems={cart.length > 0}
          onClose={() => { setShowParked(false); refreshParked(); }}
          onRecall={(parked, c) => {
            const known = parked.lines.filter((l) => variantIndex.byId.has(l.variantId));
            setCart(known.map((l) => {
              const { product, variant } = variantIndex.byId.get(l.variantId)!;
              return { variantId: l.variantId, productName: product.name, label: variant.label, qty: l.qty, discountCents: l.discountCents };
            }));
            setCartDiscountCents(parked.cartDiscountCents);
            setCustomer(c);
            setShowParked(false);
            refreshParked();
            if (known.length < parked.lines.length) setToast("Some items are no longer sold and were left out.");
          }}
        />
      )}
      {done && <DoneSheet {...done} onNext={resetSale} onReprint={() => printReceipt(done.receiptToken, false).catch((e) => setToast(`Receipt didn't print: ${e.message}`))} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-md rounded-2xl bg-ink-900/95 backdrop-blur text-white text-[13px] px-4 py-3 shadow-2xl animate-[zeno-pop_0.18s_ease-out]">{toast}</div>}
    </div>
  );
}

function PrinterMenu({ shopName, onMessage }: { shopName: string; onMessage: (m: string) => void }) {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => setDesktop(inDesktopApp()), []);
  if (!desktop) return null;
  const load = async () => {
    try {
      const r = await listPrinters();
      setPrinters(r.printers);
      setCurrent(r.current);
      setOpen(true);
    } catch (e) {
      onMessage((e as Error).message ?? String(e));
    }
  };
  const run = (fn: () => Promise<void>, ok: string) => fn().then(() => onMessage(ok)).catch((e) => onMessage(typeof e === "string" ? e : (e as Error).message));
  return (
    <>
      <button onClick={load} className={TOOL}>
        <Printer aria-hidden="true" className="size-4" />
        <span className="hidden lg:inline">Printer</span>
        {!current && <span className="size-1.5 rounded-full bg-amber-500" title="No printer chosen" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div className="card rounded-2xl shadow-xl animate-[zeno-pop_0.18s_ease-out] p-5 w-full max-w-sm grid gap-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[13.5px] font-semibold">Receipt printer</h2>
            {printers.length === 0 ? (
              <p className="text-[13.5px] text-ink-600">No printers found. Install the XP-Q80 driver and plug the printer in by USB.</p>
            ) : (
              <ul className="grid gap-1.5">
                {printers.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => run(async () => { await choosePrinter(p); setCurrent(p); }, `Receipts will print on ${p}.`)}
                      className={`w-full text-left h-10 px-3 rounded-lg border cursor-pointer ${current === p ? "bg-brand-tint border-transparent font-semibold text-brand-700" : "border-ink-200 hover:bg-ink-50"}`}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button disabled={!current} onClick={() => run(() => printTestPage(shopName), "Test slip sent.")} className="h-10 rounded-lg border border-ink-200 cursor-pointer disabled:opacity-40">Print test</button>
              <button disabled={!current} onClick={() => run(openDrawer, "Drawer opened.")} className="h-10 rounded-lg border border-ink-200 cursor-pointer disabled:opacity-40">Open drawer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Header toolbar button: quiet pill that lifts to white on hover (Zeno sidebar feel). */
const TOOL = "h-9 px-3 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-white/70 hover:text-ink-900 transition-colors cursor-pointer";

/** Category filter: the active pill slides between options like Zeno's sidebar highlight. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`relative h-8 px-3.5 rounded-full text-[12.5px] whitespace-nowrap cursor-pointer transition-colors ${on ? "text-brand-ink font-medium" : "text-ink-600 hover:text-ink-900"}`}>
      {on && <motion.span layoutId="till-category-pill" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-full bg-brand shadow-[0_1px_2px_rgba(0,0,0,0.12)]" />}
      <span className="relative">{children}</span>
    </button>
  );
}

function QtyButton({ label, onClick }: { label: "Less" | "More"; onClick: () => void }) {
  const Icon = label === "Less" ? Minus : Plus;
  return (
    <button onClick={onClick} aria-label={label === "Less" ? "One less" : "One more"} className="size-8 rounded-lg bg-white border border-ink-200 grid place-items-center text-ink-600 hover:bg-ink-50 hover:text-ink-900 active:scale-95 transition-all cursor-pointer">
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function Blocking({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-screen grid place-items-center p-6">
      <div className="card rounded-2xl p-8 max-w-sm text-center grid gap-2"><h1 className="text-[18px] font-semibold">{title}</h1><p className="text-[14px] text-ink-600">{body}</p></div>
    </div>
  );
}

function OpenShift({ shopName, logoUrl, registerId, registerName, cashierName, onOpened }: { shopName: string; logoUrl: string | null; registerId: number; registerName: string; cashierName: string; onOpened: () => void }) {
  const [float, setFloat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="h-screen grid place-items-center p-6 bg-ink-50">
      <form
        className="card rounded-2xl shadow-xl p-7 w-full max-w-sm grid gap-4 animate-[zeno-pop_0.22s_ease-out]"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = float.trim() === "" ? 0 : parseKES(float);
          if (Number.isNaN(cents) || cents < 0) return setError("Enter the cash in the drawer, e.g. 2000.");
          start(async () => {
            const r = await startShift(registerId, cents);
            if (r.ok) onOpened();
            else setError(r.error);
          });
        }}
      >
        <div className="grid gap-3">
          <div className="size-12 rounded-xl overflow-hidden flex items-center justify-center bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] border border-ink-100"><ShopMark shopName={shopName} logoUrl={logoUrl} className="text-[20px]" /></div>
          <div>
          <h1 className="text-2xl font-bold tracking-tight">Open {registerName}</h1>
          <p className="text-[13.5px] text-ink-400 mt-1">Hi {cashierName.split(" ")[0]}. Count the cash in the drawer before you start.</p>
          </div>
        </div>
        <label className="grid gap-1.5 text-[13px]">
          <span className="font-medium text-ink-600">Opening float (KES)</span>
          <input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} className="h-12 rounded-lg bg-white px-3 text-[20px] tnum border border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint" placeholder="0.00" />
        </label>
        {error && <p className="text-bad text-[13px]">{error}</p>}
        <button disabled={pending} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50">{pending ? "Opening…" : "Open till"}</button>
      </form>
    </div>
  );
}

function CustomerSlot({ customer, onChange, phoneRef }: { customer: TillCustomer | null; onChange: (c: TillCustomer | null) => void; phoneRef: React.RefObject<HTMLInputElement | null> }) {
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (customer) {
    return (
      <div className="mx-5 mt-3 mb-2 rounded-xl bg-brand-wash border border-brand-tint px-3.5 py-3 flex justify-between items-start gap-3">
        <span className="size-9 shrink-0 rounded-full bg-brand text-brand-ink grid place-items-center text-[13px] font-semibold">{(customer.businessName || customer.name || "C").slice(0, 1).toUpperCase()}</span>
        <div className="grid gap-0.5 min-w-0 flex-1">
          <span className="text-[13.5px] font-semibold truncate">{customer.businessName || customer.name || "Customer"} <span className="text-ink-400 font-normal">· {customer.phoneMasked}</span></span>
          <span className="text-[12.5px] text-ink-600">
            {customer.type === "wholesale" ? "Wholesale" : "Retail"}
            {customer.earnsPoints && ` · ${(customer.pointsBalance / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })} pts`}
            {customer.creditEnabled && ` · KES ${kes(customer.creditAvailableCents)} credit left`}
          </span>
        </div>
        <button className="h-7 px-2.5 rounded-full text-[12px] font-medium text-ink-600 bg-white/70 border border-brand-tint hover:text-ink-900 hover:bg-white transition-colors cursor-pointer" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }

  const lookup = () => {
    setError(null);
    if (!normalizeKenyanPhone(phone) && !parseCardNumber(phone)) return setError("Enter a Kenyan mobile (e.g. 0712 345 678) or scan their loyalty card.");
    start(async () => {
      const r = await lookupCustomer(phone);
      if (!r.ok) return setError(r.error);
      if (r.data) { onChange(r.data); setPhone(""); }
      else if (parseCardNumber(phone)) setError("No customer has that card number.");
      else setCreating(true);
    });
  };

  return (
    <div className="mx-5 mt-3 mb-2 grid gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1 flex items-center">
        <Phone aria-hidden="true" className="absolute left-3 size-4 text-ink-400 pointer-events-none" />
        <input
          ref={phoneRef}
          value={phone}
          inputMode="tel"
          onChange={(e) => { setPhone(e.target.value); setCreating(false); }}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="Customer phone (F4)"
          className="h-11 w-full rounded-lg bg-white pl-9 pr-3 text-[14.5px] tnum border border-ink-200 placeholder:text-ink-400 transition-all focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint select-text"
        />
        </div>
        <button onClick={lookup} disabled={pending} className="h-11 px-4 rounded-lg bg-white border border-ink-200 text-[13px] font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900 transition-colors cursor-pointer">{pending ? "…" : "Find"}</button>
      </div>
      {creating && (
        <form
          className="rounded-xl bg-ink-50 border border-ink-100 p-3 grid gap-2 animate-[zeno-pop_0.18s_ease-out]"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await quickCreateCustomer({ phone, name, marketingConsent: consent });
              if (!r.ok) return setError(r.error);
              onChange(r.data);
              setPhone(""); setName(""); setConsent(false); setCreating(false);
            });
          }}
        >
          <span className="text-[12.5px] text-ink-600">New customer. Their name is optional.</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-10 rounded-lg bg-white px-3 text-[14px] border border-ink-200 select-text" />
          <label className="flex items-start gap-2 text-[12.5px] text-ink-600">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            Customer agrees to receive offers by SMS (receipts are always sent)
          </label>
          <button className="h-10 rounded-lg bg-brand text-brand-ink text-[13.5px] font-semibold cursor-pointer">Add customer</button>
        </form>
      )}
      {error && <p className="text-bad text-[12.5px]">{error}</p>}
    </div>
  );
}

/** "Usually buys": the customer's repeat items, one tap to add what they took last time. */
function UsualStrip({ customerId, inCart, resolve, priceOf, onAdd }: {
  customerId: number;
  inCart: Set<number>;
  resolve: (variantId: number) => { product: TillProduct; variant: TillVariant } | undefined;
  priceOf: (v: TillVariant) => number;
  onAdd: (p: TillProduct, v: TillVariant, qty: number) => void;
}) {
  const [data, setData] = useState<{ items: UsualItem[]; lastVisit: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    customerUsual(customerId).then((r) => live && r.ok && setData(r.data));
    return () => { live = false; };
  }, [customerId]);
  const items = (data?.items ?? []).flatMap((i) => {
    const hit = resolve(i.variantId);
    return hit && priceOf(hit.variant) > 0 ? [{ ...i, ...hit }] : [];
  });
  if (!data) return null;
  if (items.length === 0) return <p className="mx-5 mb-2 text-[11.5px] text-ink-400">First visit here, or nothing on file yet.</p>;
  const lastVisit = data.lastVisit ? new Date(`${data.lastVisit}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
  const toAdd = items.filter((i) => !inCart.has(i.variantId));
  return (
    <div className="mx-5 mb-2 grid gap-1.5 animate-[zeno-pop_0.18s_ease-out]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Usually buys{lastVisit ? ` · last visit ${lastVisit}` : ""}</span>
        {toAdd.length > 1 && (
          <button onClick={() => toAdd.forEach((i) => onAdd(i.product, i.variant, i.lastQty))} className="text-[11.5px] font-medium text-brand-700 hover:underline cursor-pointer">Add all</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => {
          const added = inCart.has(i.variantId);
          return (
            <button
              key={i.variantId}
              disabled={added}
              onClick={() => onAdd(i.product, i.variant, i.lastQty)}
              title={`Bought ${i.times} time${i.times === 1 ? "" : "s"} · last ${i.lastDate}`}
              className={`max-w-full inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-full border text-[12px] transition-all cursor-pointer ${added ? "bg-ink-50 border-ink-100 text-ink-400 cursor-default" : "bg-white border-ink-200 text-ink-900 hover:border-brand hover:bg-brand-wash active:scale-[0.97]"}`}
            >
              {i.variant.swatchHex ? <span className="size-3.5 shrink-0 rounded-full border border-black/10" style={{ background: i.variant.swatchHex }} /> : <Plus aria-hidden="true" className="size-3.5 shrink-0 text-brand-700" />}
              <span className="truncate">{i.product.name}{i.variant.label ? ` · ${i.variant.label}` : ""}</span>
              {i.lastQty > 1 && <span className="tnum text-ink-400">×{i.lastQty}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DiscountButton({ currentCents, maxCents, limitCents, onSet }: { currentCents: number; maxCents: number; limitCents: number | null; onSet: (c: number, ownerPin: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState<number | null>(null);
  if (needPin !== null) {
    return (
      <PinPrompt
        title={`Owner approval for KES ${kes(needPin)} off`}
        onCancel={() => setNeedPin(null)}
        onPin={(pin) => { onSet(needPin, pin); setNeedPin(null); setOpen(false); }}
      />
    );
  }
  if (!open) return <button className="font-medium text-brand-700 hover:underline cursor-pointer" onClick={() => { setValue(currentCents ? String(currentCents / 100) : ""); setOpen(true); }}>{currentCents ? "Edit discount" : "Add discount"}</button>;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
      <form
        className="card rounded-2xl shadow-xl animate-[zeno-pop_0.18s_ease-out] p-5 w-full max-w-xs grid gap-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const input = value.trim();
          let cents = input.endsWith("%") ? Math.round((maxCents * Number(input.slice(0, -1))) / 100) : parseKES(input || "0");
          if (Number.isNaN(cents) || cents < 0) return setError("Enter an amount like 100 or a percent like 10%.");
          cents = Math.min(cents, maxCents);
          if (limitCents !== null && cents > limitCents) return setNeedPin(cents);
          onSet(cents, null);
          setOpen(false);
        }}
      >
        <h2 className="text-[13.5px] font-semibold">Discount on this sale</h2>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 100 or 10%" className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border border-ink-200 select-text" />
        {limitCents !== null && <p className="text-[12px] text-ink-400">Above KES {kes(limitCents)} the owner enters their PIN.</p>}
        {error && <p className="text-bad text-[12.5px]">{error}</p>}
        <div className="flex gap-2">
          <button className="h-10 flex-1 rounded-lg bg-brand text-brand-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 active:scale-[0.99] transition-all cursor-pointer">Apply</button>
          {currentCents > 0 && <button type="button" onClick={() => { onSet(0, null); setOpen(false); }} className="h-10 px-3 rounded-lg border border-ink-200 cursor-pointer">Remove</button>}
        </div>
      </form>
    </div>
  );
}

function VariantPicker({ product, priceOf, onPick, onClose }: { product: TillProduct; priceOf: (v: TillVariant) => number; onPick: (v: TillVariant) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card rounded-2xl shadow-xl animate-[zeno-pop_0.18s_ease-out] p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto grid gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-baseline gap-3">
          <h2 className="text-[15px] font-semibold">{product.name}</h2>
          <span className="text-[12.5px] text-ink-400">Pick a {product.optionNames.join(" / ").toLowerCase() || "version"}</span>
        </div>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
          {product.variants.map((v) => (
            <button key={v.id} onClick={() => onPick(v)} className="rounded-xl bg-white border border-ink-200 p-3 grid gap-2 text-left hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)] active:scale-[0.98] transition-all duration-200 cursor-pointer">
              <span className="h-10 rounded-lg" style={{ background: v.swatchHex ?? "var(--color-ink-50)" }} />
              <span className="text-[13.5px] font-medium">{v.label || "Standard"}</span>
              <span className="text-[11.5px] text-ink-400 tnum"><span className="text-[13px] font-semibold text-ink-900">{priceOf(v) > 0 ? kes(priceOf(v)) : "No price"}</span> · {v.onHand} in stock</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaySheet({ totalCents, customer, exchange, onClose, submit }: { totalCents: number; customer: TillCustomer; exchange: ExchangeCredit | null; onClose: () => void; submit: (p: Tender[], key: string) => Promise<string | null> }) {
  const idempotencyKey = useRef(crypto.randomUUID()).current;
  // Exchange credit is applied first, automatically.
  const [tenders, setTenders] = useState<Tender[]>(() =>
    exchange && exchange.customerId === customer.id ? [{ method: "exchange", amountCents: Math.min(exchange.creditLeftCents, totalCents), returnId: exchange.returnId }] : []
  );
  const [method, setMethod] = useState<Tender["method"]>("cash");
  const [amount, setAmount] = useState("");
  const [cashGiven, setCashGiven] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const applied = tenders.reduce((s, t) => s + t.amountCents, 0);
  const remaining = totalCents - applied;
  const amountCents = amount.trim() ? parseKES(amount) : remaining;

  function addTender(): Tender[] | null {
    setError(null);
    if (Number.isNaN(amountCents) || amountCents <= 0) { setError("Enter an amount."); return null; }
    if (amountCents > remaining) { setError(`Only KES ${kes(remaining)} is left to pay.`); return null; }
    let t: Tender;
    if (method === "cash") {
      if (tenders.some((x) => x.method === "cash")) { setError("Cash is already added — remove it to change the amount."); return null; }
      const given = cashGiven.trim() ? parseKES(cashGiven) : amountCents;
      if (Number.isNaN(given) || given < amountCents) { setError("Cash handed over is less than the amount."); return null; }
      t = { method, amountCents, tenderedCents: given };
    } else if (method === "mpesa") {
      const c = code.trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(c)) { setError("Type the 10-character M-Pesa code from the customer's SMS."); return null; }
      if (tenders.some((x) => x.mpesaCode === c)) { setError("That code is already added."); return null; }
      t = { method, amountCents, mpesaCode: c };
    } else if (method === "points") {
      const used = tenders.filter((x) => x.method === "points").reduce((a, x) => a + x.amountCents, 0);
      if (amountCents + used > customer.pointsValueCents) { setError(`Points cover up to KES ${kes(customer.pointsValueCents - used)}.`); return null; }
      t = { method, amountCents };
    } else {
      if (amountCents > customer.creditAvailableCents) { setError(`Only KES ${kes(customer.creditAvailableCents)} of credit is available.`); return null; }
      t = { method, amountCents };
    }
    const next = [...tenders, t];
    setTenders(next);
    setAmount(""); setCashGiven(""); setCode("");
    return next;
  }

  function finish(list: Tender[]) {
    start(async () => {
      const err = await submit(list, idempotencyKey);
      if (err) setError(err);
    });
  }

  const cashChange = method === "cash" && cashGiven.trim() ? parseKES(cashGiven) - (Number.isNaN(amountCents) ? 0 : amountCents) : 0;
  const methods: { key: Tender["method"]; label: string }[] = [
    { key: "cash", label: "Cash" },
    { key: "mpesa", label: "M-Pesa" },
    ...(customer.canRedeemPoints ? [{ key: "points" as const, label: "Points" }] : []),
    ...(customer.creditEnabled ? [{ key: "credit" as const, label: "On account" }] : []),
  ];
  const tenderLabel = (t: Tender) =>
    t.method === "cash" ? "Cash" : t.method === "mpesa" ? `M-Pesa ${t.mpesaCode}` : t.method === "points" ? "Loyalty points" : t.method === "exchange" ? "Exchange credit" : "On account";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !pending && onClose()}>
      <div className="card rounded-2xl shadow-xl animate-[zeno-pop_0.18s_ease-out] p-6 w-full max-w-md grid gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-baseline">
          <h2 className="text-[15px] font-semibold">Take payment</h2>
          <span className="text-[26px] font-semibold tnum tracking-tight">{kes(totalCents)}</span>
        </div>

        {tenders.length > 0 && (
          <ul className="grid gap-1.5 text-[13.5px]">
            {tenders.map((t, i) => (
              <li key={i} className="flex justify-between items-center rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
                <span>{tenderLabel(t)}</span>
                <span className="flex items-center gap-3 tnum">{kes(t.amountCents)}<button aria-label="Remove payment" className="size-6 rounded-full grid place-items-center text-ink-400 hover:text-bad hover:bg-red-50 cursor-pointer" onClick={() => setTenders((x) => x.filter((_, j) => j !== i))}><X aria-hidden="true" className="size-3.5" /></button></span>
              </li>
            ))}
          </ul>
        )}

        {remaining > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {methods.map((m) => (
                <button key={m.key} onClick={() => setMethod(m.key)} className={`h-11 rounded-lg text-[13.5px] font-medium cursor-pointer border transition-all ${method === m.key ? "bg-brand text-brand-ink border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "bg-white text-ink-600 border-ink-200 hover:bg-ink-50 hover:text-ink-900"}`}>{m.label}</button>
              ))}
            </div>
            <label className="grid gap-1 text-[12.5px] text-ink-600">
              Amount (KES) — leave blank for the full {kes(remaining)}
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={kes(remaining)} className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border border-ink-200 select-text" />
            </label>
            {method === "cash" && (
              <div className="grid gap-2">
                <label className="grid gap-1 text-[12.5px] text-ink-600">
                  Cash handed over
                  <input autoFocus value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} inputMode="decimal" className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border border-ink-200 select-text" />
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[amountCents, 50_000, 100_000, 200_000].filter((v, i, a) => v > 0 && v >= amountCents && a.indexOf(v) === i).map((v) => (
                    <button key={v} onClick={() => setCashGiven(String(v / 100))} className="h-9 px-3 rounded-full border border-ink-200 text-[13px] tnum hover:bg-ink-50 cursor-pointer">{v === amountCents ? "Exact" : kes(v)}</button>
                  ))}
                </div>
                {cashChange > 0 && <p className="text-[15px]">Change: <span className="font-semibold text-good tnum">{kes(cashChange)}</span></p>}
              </div>
            )}
            {method === "mpesa" && (
              <label className="grid gap-1 text-[12.5px] text-ink-600">
                M-Pesa code from the customer's SMS
                <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} placeholder="SJK4H7QX2M" className="h-11 rounded-lg bg-white px-3 text-[16px] tracking-widest uppercase border border-ink-200 select-text" />
              </label>
            )}
            {method === "credit" && <p className="text-[13px] text-ink-600">KES {kes(customer.creditAvailableCents)} of credit available.</p>}
            {method === "points" && <p className="text-[13px] text-ink-600">{fmtPoints(customer.pointsBalance)} points = KES {kes(customer.pointsValueCents)} available. Points aren't earned on the part paid with points.</p>}
            <div className="grid grid-cols-2 gap-2">
              <button disabled={pending} onClick={() => addTender()} className="h-12 rounded-lg border border-ink-200 font-medium hover:bg-ink-50 cursor-pointer">Split payment</button>
              <button
                disabled={pending}
                onClick={() => {
                  if (amountCents !== remaining) return setError("For a split payment, use “Split payment” and add the rest.");
                  const list = addTender();
                  if (list) finish(list);
                }}
                className="h-12 rounded-lg bg-brand text-brand-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {pending ? "Saving…" : "Complete sale"}
              </button>
            </div>
          </>
        ) : (
          <button disabled={pending} onClick={() => finish(tenders)} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50">{pending ? "Saving…" : "Complete sale"}</button>
        )}
        {error && <p role="alert" className="text-bad text-[13px]">{error}</p>}
      </div>
    </div>
  );
}

function DoneSheet({ receiptNo, changeCents, totalCents, pointsEarned, pointsBalance, onNext, onReprint }: { receiptNo: string; changeCents: number; totalCents: number; pointsEarned: number; pointsBalance: number | null; onNext: () => void; onReprint: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Enter" && onNext();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onNext]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4">
      <div className="card rounded-2xl shadow-xl animate-[zeno-pop_0.18s_ease-out] p-7 w-full max-w-sm grid gap-4 text-center">
        <span className="justify-self-center inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">Sale {receiptNo} saved</span>
        <span className="text-[12.5px] text-ink-400 tnum">KES {kes(totalCents)}</span>
        {changeCents > 0 ? (
          <div className="grid gap-1"><span className="text-[14px] text-ink-600">Give change</span><span className="text-[40px] font-semibold tnum tracking-tight text-good">{kes(changeCents)}</span></div>
        ) : (
          <span className="text-[22px] font-semibold">Paid in full</span>
        )}
        {pointsBalance !== null && (
          <span className="text-[13px] text-ink-600">+{fmtPoints(pointsEarned)} points · balance {fmtPoints(pointsBalance)}</span>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onReprint} className="h-12 rounded-lg border border-ink-200 font-medium hover:bg-ink-50 cursor-pointer">Print again</button>
          <button autoFocus onClick={onNext} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-brand-600 active:scale-[0.99] transition-all cursor-pointer">New sale ↵</button>
        </div>
      </div>
    </div>
  );
}
