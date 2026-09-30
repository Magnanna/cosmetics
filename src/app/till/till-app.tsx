"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { completeSale, lookupCustomer, parkSale, parkedList, quickCreateCustomer, startShift, type ParkedCart, type TillCustomer } from "./actions";
import { MoreMenu, ParkedSales, PinPrompt, SwitchUser, type ExchangeCredit } from "./till-dialogs";
import { useRouter } from "next/navigation";
import { applyOffers, type OfferDef } from "@/lib/offers";
import { fmtPoints } from "@/lib/loyalty";
import { choosePrinter, inDesktopApp, listPrinters, openDrawer, printReceipt, printTestPage } from "@/lib/print-client";
import { parseKES } from "@/lib/money";
import { normalizeKenyanPhone } from "@/lib/phone";
import type { Role } from "@/lib/context";

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
    (p: TillProduct, v: TillVariant) => {
      if (priceOf(v) <= 0) {
        setToast(`${p.name}${v.label ? ` · ${v.label}` : ""} has no approved price yet.`);
        return;
      }
      setCart((c) => {
        const i = c.findIndex((l) => l.variantId === v.id);
        if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
        return [...c, { variantId: v.id, productName: p.name, label: v.label, qty: 1, discountCents: 0 }];
      });
      if (v.onHand <= 0) setToast(`Heads up: the system shows no ${p.name} in stock. Sale allowed — check the shelf count.`);
    },
    [priceOf]
  );

  const addByBarcode = useCallback(
    (code: string) => {
      const hit = variantIndex.byCode.get(code.trim());
      if (!hit) {
        setToast(`Barcode ${code} not found — search by name or tell a staff member.`);
        return false;
      }
      addVariant(hit.product, hit.variant);
      return true;
    },
    [variantIndex, addVariant]
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
    return <OpenShift registerId={props.registerId} registerName={props.registerName} cashierName={props.cashierName} onOpened={() => setShiftOpen(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-ink-50 text-ink-900 select-none">
      <header className="sidebar-chrome hairline-b h-12 shrink-0 flex items-center justify-between gap-3 px-4 text-[13px]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-brand text-brand-ink grid place-items-center font-bold text-[12px]">K</div>
          <span className="font-semibold truncate">{props.shopName}</span>
          <span className="text-ink-400 hidden sm:inline">{props.registerName}</span>
        </div>
        <div className="flex items-center gap-4 text-ink-600">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${online ? "bg-good" : "bg-bad"}`} />
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
          {parkedCount > 0 && <button onClick={() => setShowParked(true)} className="text-brand-700 font-medium cursor-pointer">Parked ({parkedCount})</button>}
          <button onClick={() => setSwitching(true)} className="flex items-center gap-1.5 cursor-pointer hover:text-ink-900" title="Switch who is using the till">
            <span className="w-6 h-6 rounded-full bg-brand-tint text-brand-700 grid place-items-center text-[11px] font-bold">{props.cashierName.slice(0, 1).toUpperCase()}</span>
            <span className="hidden sm:inline">{props.cashierName}</span>
            <span className="text-ink-400">· Switch</span>
          </button>
          {props.role !== "cashier" && <Link href="/" className="text-brand-700 underline">Back office</Link>}
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        {/* Products */}
        <section className="min-h-0 flex flex-col p-4 gap-3">
          <input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                const exact = variantIndex.byCode.get(query.trim());
                if (exact) { addVariant(exact.product, exact.variant); setQuery(""); }
                else if (visible.length === 1 && visible[0].variants.length === 1) { addVariant(visible[0], visible[0].variants[0]); setQuery(""); }
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search name, brand or shade — or scan a barcode (F2)"
            className="h-12 w-full rounded-xl bg-white px-4 text-[15px] border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint select-text"
          />
          <div className="flex gap-2 overflow-x-auto pb-1 shrink-0">
            <Chip on={category === null} onClick={() => setCategory(null)}>All</Chip>
            {props.categories.map((c) => (
              <Chip key={c.id} on={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="text-[14px] text-ink-400 p-6 text-center">{props.products.length === 0 ? "No products yet — add them in the back office." : "Nothing matches that search."}</p>
            ) : (
              <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
                {visible.map((p) => {
                  const prices = p.variants.map(priceOf).filter((c) => c > 0);
                  const min = prices.length ? Math.min(...prices) : 0;
                  const swatches = p.variants.filter((v) => v.swatchHex).slice(0, 5);
                  return (
                    <button
                      key={p.id}
                      onClick={() => (p.variants.length === 1 ? addVariant(p, p.variants[0]) : setPicker(p))}
                      className="card text-left p-3 grid gap-2 content-start min-h-[112px] hover:border-brand active:scale-[0.98] transition cursor-pointer"
                    >
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" loading="lazy" className="h-16 w-full rounded-md object-contain bg-white" />
                      ) : (
                      <div className="h-9 rounded-md flex overflow-hidden bg-ink-50">
                        {swatches.length > 0 ? swatches.map((v) => <span key={v.id} className="flex-1" style={{ background: v.swatchHex! }} />) : <span className="flex-1 grid place-items-center text-[11px] text-ink-400">{p.brand ?? ""}</span>}
                      </div>
                      )}
                      <span className="text-[13px] font-medium leading-snug line-clamp-2">{p.name}</span>
                      <span className="text-[12px] text-ink-400 tnum">
                        {p.variants.length > 1 ? `${p.variants.length} ${p.optionNames[0]?.toLowerCase() ?? "options"} · from ` : ""}
                        {min > 0 ? kes(min) : "No price"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cart */}
        <aside className="min-h-0 flex flex-col bg-white border-l-[0.5px] border-ink-100">
          <CustomerSlot customer={customer} onChange={(c) => { setCustomer(c); if (!c || c.id !== exchange?.customerId) setExchange(null); }} phoneRef={phoneRef} />
          {exchange && (
            <div className="mx-4 mb-2 rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] flex justify-between">
              <span>Exchange credit from {exchange.returnNo}</span>
              <span className="tnum font-semibold">KES {kes(exchange.creditLeftCents)}</span>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-4">
            {lines.length === 0 ? (
              <p className="text-[13.5px] text-ink-400 text-center py-10">Scan or tap a product to start.</p>
            ) : (
              <ul className="divide-y-[0.5px] divide-ink-100">
                {lines.map((l) => (
                  <li key={l.variantId} className="py-3 grid gap-1.5">
                    <div className="flex justify-between gap-3 text-[13.5px]">
                      <span className="font-medium leading-snug">{l.productName}{l.label && <span className="text-ink-400 font-normal"> · {l.label}</span>}</span>
                      <span className="tnum whitespace-nowrap">
                        {l.promo > 0 && <s className="text-ink-400 mr-1.5">{kes(l.gross)}</s>}
                        {kes(l.net)}
                      </span>
                    </div>
                    {l.offerTitle && <span className="text-[11.5px] text-brand-700">{l.offerTitle}</span>}
                    <div className="flex items-center justify-between gap-2 text-[12.5px] text-ink-600">
                      <div className="flex items-center gap-1">
                        <QtyButton label="−" onClick={() => setCart((c) => c.flatMap((x) => (x.variantId !== l.variantId ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1, discountCents: Math.min(x.discountCents, (x.qty - 1) * l.unit) }] : [])))} />
                        <span className="w-8 text-center tnum text-[14px] text-ink-900">{l.qty}</span>
                        <QtyButton label="+" onClick={() => setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x)))} />
                        <span className="ml-2 tnum">× {kes(l.unit)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {l.discountCents > 0 && <span className="text-brand-700 tnum">−{kes(l.discountCents)}</span>}
                        <button className="text-ink-400 hover:text-bad cursor-pointer" onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))}>Remove</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="hairline-t p-4 grid gap-2.5">
            <div className="flex justify-between text-[13px] text-ink-600">
              <span>{units} item{units === 1 ? "" : "s"}</span>
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
            <div className="flex justify-between items-baseline">
              <span className="text-[13px] text-ink-400">Total KES{wholesale ? " · wholesale prices" : ""}</span>
              <span className="text-[30px] font-semibold tracking-tight tnum">{kes(totalCents)}</span>
            </div>
            <button
              disabled={lines.length === 0 || !customer || totalCents <= 0}
              onClick={() => setPaying(true)}
              className="h-14 rounded-xl bg-brand text-brand-ink text-[17px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-brand-600 transition"
            >
              {!customer && lines.length > 0 ? "Add the customer's phone to check out" : "Checkout"}
            </button>
            {lines.length > 0 && (
              <div className="flex justify-between">
                <button
                  className="text-[12.5px] text-brand-700 underline cursor-pointer"
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
                  Park sale (F8)
                </button>
                <button className="text-[12.5px] text-ink-400 hover:text-bad cursor-pointer" onClick={resetSale}>Clear sale</button>
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
      {toast && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 max-w-md rounded-xl bg-ink-900 text-white text-[13.5px] px-4 py-3 shadow-xl">{toast}</div>}
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
      <button onClick={load} className="text-ink-600 hover:text-ink-900 cursor-pointer">Printer{current ? "" : " ⚠"}</button>
      {open && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="card p-5 w-full max-w-sm grid gap-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold">Receipt printer</h2>
            {printers.length === 0 ? (
              <p className="text-[13.5px] text-ink-600">No printers found. Install the XP-Q80 driver and plug the printer in by USB.</p>
            ) : (
              <ul className="grid gap-1.5">
                {printers.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => run(async () => { await choosePrinter(p); setCurrent(p); }, `Receipts will print on ${p}.`)}
                      className={`w-full text-left h-10 px-3 rounded-lg border-[0.5px] cursor-pointer ${current === p ? "bg-brand-tint border-transparent font-semibold text-brand-700" : "border-ink-200 hover:bg-ink-50"}`}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button disabled={!current} onClick={() => run(() => printTestPage(shopName), "Test slip sent.")} className="h-10 rounded-lg border-[0.5px] border-ink-200 cursor-pointer disabled:opacity-40">Print test</button>
              <button disabled={!current} onClick={() => run(openDrawer, "Drawer opened.")} className="h-10 rounded-lg border-[0.5px] border-ink-200 cursor-pointer disabled:opacity-40">Open drawer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`h-9 px-3.5 rounded-full text-[13px] whitespace-nowrap cursor-pointer border-[0.5px] ${on ? "bg-brand-tint text-brand-700 border-transparent font-semibold" : "bg-white text-ink-600 border-ink-200 hover:bg-ink-50"}`}>
      {children}
    </button>
  );
}

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="w-9 h-9 rounded-lg border-[0.5px] border-ink-200 text-[16px] hover:bg-ink-50 cursor-pointer">{label}</button>;
}

function Blocking({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-screen grid place-items-center p-6">
      <div className="card p-8 max-w-sm text-center grid gap-2"><h1 className="text-[18px] font-semibold">{title}</h1><p className="text-[14px] text-ink-600">{body}</p></div>
    </div>
  );
}

function OpenShift({ registerId, registerName, cashierName, onOpened }: { registerId: number; registerName: string; cashierName: string; onOpened: () => void }) {
  const [float, setFloat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="h-screen grid place-items-center p-6 bg-ink-50">
      <form
        className="card p-7 w-full max-w-sm grid gap-4"
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
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Open {registerName}</h1>
          <p className="text-[13.5px] text-ink-400 mt-1">Hi {cashierName.split(" ")[0]}. Count the cash in the drawer before you start.</p>
        </div>
        <label className="grid gap-1.5 text-[13px]">
          <span className="font-medium text-ink-600">Opening float (KES)</span>
          <input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} className="h-12 rounded-lg bg-white px-3 text-[20px] tnum border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint" placeholder="0.00" />
        </label>
        {error && <p className="text-bad text-[13px]">{error}</p>}
        <button disabled={pending} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer disabled:opacity-50">{pending ? "Opening…" : "Open till"}</button>
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
      <div className="m-4 mb-2 rounded-xl bg-brand-wash px-4 py-3 flex justify-between items-start gap-3">
        <div className="grid gap-0.5 min-w-0">
          <span className="text-[14px] font-semibold truncate">{customer.businessName || customer.name || "Customer"} <span className="text-ink-400 font-normal">· {customer.phoneMasked}</span></span>
          <span className="text-[12.5px] text-ink-600">
            {customer.type === "wholesale" ? "Wholesale" : "Retail"}
            {customer.earnsPoints && ` · ${(customer.pointsBalance / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })} pts`}
            {customer.creditEnabled && ` · KES ${kes(customer.creditAvailableCents)} credit left`}
          </span>
        </div>
        <button className="text-[12.5px] text-ink-600 hover:text-ink-900 cursor-pointer" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }

  const lookup = () => {
    setError(null);
    if (!normalizeKenyanPhone(phone)) return setError("Enter a Kenyan mobile, e.g. 0712 345 678.");
    start(async () => {
      const r = await lookupCustomer(phone);
      if (!r.ok) return setError(r.error);
      if (r.data) { onChange(r.data); setPhone(""); }
      else setCreating(true);
    });
  };

  return (
    <div className="m-4 mb-2 grid gap-2">
      <div className="flex gap-2">
        <input
          ref={phoneRef}
          value={phone}
          inputMode="tel"
          onChange={(e) => { setPhone(e.target.value); setCreating(false); }}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="Customer phone (F4)"
          className="h-11 flex-1 rounded-lg bg-white px-3 text-[15px] tnum border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint select-text"
        />
        <button onClick={lookup} disabled={pending} className="h-11 px-4 rounded-lg border-[0.5px] border-ink-200 text-[13.5px] font-medium hover:bg-ink-50 cursor-pointer">{pending ? "…" : "Find"}</button>
      </div>
      {creating && (
        <form
          className="rounded-xl bg-ink-50 p-3 grid gap-2"
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-10 rounded-lg bg-white px-3 text-[14px] border-[0.5px] border-ink-200 select-text" />
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
  if (!open) return <button className="text-brand-700 underline cursor-pointer" onClick={() => { setValue(currentCents ? String(currentCents / 100) : ""); setOpen(true); }}>{currentCents ? "Edit discount" : "Add discount"}</button>;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={() => setOpen(false)}>
      <form
        className="card p-5 w-full max-w-xs grid gap-3"
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
        <h2 className="text-[15px] font-semibold">Discount on this sale</h2>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 100 or 10%" className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border-[0.5px] border-ink-200 select-text" />
        {limitCents !== null && <p className="text-[12px] text-ink-400">Above KES {kes(limitCents)} the owner enters their PIN.</p>}
        {error && <p className="text-bad text-[12.5px]">{error}</p>}
        <div className="flex gap-2">
          <button className="h-10 flex-1 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer">Apply</button>
          {currentCents > 0 && <button type="button" onClick={() => { onSet(0, null); setOpen(false); }} className="h-10 px-3 rounded-lg border-[0.5px] border-ink-200 cursor-pointer">Remove</button>}
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto grid gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-baseline gap-3">
          <h2 className="text-[17px] font-semibold">{product.name}</h2>
          <span className="text-[12.5px] text-ink-400">Pick a {product.optionNames.join(" / ").toLowerCase() || "version"}</span>
        </div>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
          {product.variants.map((v) => (
            <button key={v.id} onClick={() => onPick(v)} className="rounded-xl border-[0.5px] border-ink-200 p-3 grid gap-2 text-left hover:border-brand cursor-pointer">
              <span className="h-10 rounded-md" style={{ background: v.swatchHex ?? "var(--color-ink-50)" }} />
              <span className="text-[13.5px] font-medium">{v.label || "Standard"}</span>
              <span className="text-[12px] text-ink-400 tnum">{priceOf(v) > 0 ? kes(priceOf(v)) : "No price"} · {v.onHand} in stock</span>
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={() => !pending && onClose()}>
      <div className="card p-6 w-full max-w-md grid gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-baseline">
          <h2 className="text-[17px] font-semibold">Take payment</h2>
          <span className="text-[26px] font-semibold tnum tracking-tight">{kes(totalCents)}</span>
        </div>

        {tenders.length > 0 && (
          <ul className="grid gap-1.5 text-[13.5px]">
            {tenders.map((t, i) => (
              <li key={i} className="flex justify-between items-center rounded-lg bg-ink-50 px-3 py-2">
                <span>{tenderLabel(t)}</span>
                <span className="flex items-center gap-3 tnum">{kes(t.amountCents)}<button className="text-ink-400 hover:text-bad cursor-pointer" onClick={() => setTenders((x) => x.filter((_, j) => j !== i))}>✕</button></span>
              </li>
            ))}
          </ul>
        )}

        {remaining > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {methods.map((m) => (
                <button key={m.key} onClick={() => setMethod(m.key)} className={`h-11 rounded-lg text-[14px] font-medium cursor-pointer border-[0.5px] ${method === m.key ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200 hover:bg-ink-50"}`}>{m.label}</button>
              ))}
            </div>
            <label className="grid gap-1 text-[12.5px] text-ink-600">
              Amount (KES) — leave blank for the full {kes(remaining)}
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={kes(remaining)} className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border-[0.5px] border-ink-200 select-text" />
            </label>
            {method === "cash" && (
              <div className="grid gap-2">
                <label className="grid gap-1 text-[12.5px] text-ink-600">
                  Cash handed over
                  <input autoFocus value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} inputMode="decimal" className="h-11 rounded-lg bg-white px-3 text-[16px] tnum border-[0.5px] border-ink-200 select-text" />
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[amountCents, 50_000, 100_000, 200_000].filter((v, i, a) => v > 0 && v >= amountCents && a.indexOf(v) === i).map((v) => (
                    <button key={v} onClick={() => setCashGiven(String(v / 100))} className="h-9 px-3 rounded-full border-[0.5px] border-ink-200 text-[13px] tnum hover:bg-ink-50 cursor-pointer">{v === amountCents ? "Exact" : kes(v)}</button>
                  ))}
                </div>
                {cashChange > 0 && <p className="text-[15px]">Change: <span className="font-semibold text-good tnum">{kes(cashChange)}</span></p>}
              </div>
            )}
            {method === "mpesa" && (
              <label className="grid gap-1 text-[12.5px] text-ink-600">
                M-Pesa code from the customer's SMS
                <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} placeholder="SJK4H7QX2M" className="h-11 rounded-lg bg-white px-3 text-[16px] tracking-widest uppercase border-[0.5px] border-ink-200 select-text" />
              </label>
            )}
            {method === "credit" && <p className="text-[13px] text-ink-600">KES {kes(customer.creditAvailableCents)} of credit available.</p>}
            {method === "points" && <p className="text-[13px] text-ink-600">{fmtPoints(customer.pointsBalance)} points = KES {kes(customer.pointsValueCents)} available. Points aren't earned on the part paid with points.</p>}
            <div className="grid grid-cols-2 gap-2">
              <button disabled={pending} onClick={() => addTender()} className="h-12 rounded-lg border-[0.5px] border-ink-200 font-medium hover:bg-ink-50 cursor-pointer">Split payment</button>
              <button
                disabled={pending}
                onClick={() => {
                  if (amountCents !== remaining) return setError("For a split payment, use “Split payment” and add the rest.");
                  const list = addTender();
                  if (list) finish(list);
                }}
                className="h-12 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer disabled:opacity-50"
              >
                {pending ? "Saving…" : "Complete sale"}
              </button>
            </div>
          </>
        ) : (
          <button disabled={pending} onClick={() => finish(tenders)} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer disabled:opacity-50">{pending ? "Saving…" : "Complete sale"}</button>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="card p-7 w-full max-w-sm grid gap-4 text-center">
        <span className="text-[13px] text-ink-400">Sale {receiptNo} · KES {kes(totalCents)}</span>
        {changeCents > 0 ? (
          <div className="grid gap-1"><span className="text-[14px] text-ink-600">Give change</span><span className="text-[40px] font-semibold tnum tracking-tight text-good">{kes(changeCents)}</span></div>
        ) : (
          <span className="text-[22px] font-semibold">Paid in full</span>
        )}
        {pointsBalance !== null && (
          <span className="text-[13px] text-ink-600">+{fmtPoints(pointsEarned)} points · balance {fmtPoints(pointsBalance)}</span>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onReprint} className="h-12 rounded-lg border-[0.5px] border-ink-200 font-medium hover:bg-ink-50 cursor-pointer">Print again</button>
          <button autoFocus onClick={onNext} className="h-12 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer">New sale ↵</button>
        </div>
      </div>
    </div>
  );
}
