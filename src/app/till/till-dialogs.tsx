"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cashMovement, endShift, findSale, payOnAccount, payOutExchangeCredit, returnItems, xReport, type ReturnableSale, type TillCustomer } from "./actions";
import type { ShiftSummary } from "@/lib/cashup";
import { parseKES } from "@/lib/money";
import type { Role } from "@/lib/context";

export interface ExchangeCredit {
  returnId: number;
  returnNo: string;
  customerId: number;
  creditLeftCents: number;
}

const kes = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-KE")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const inputCls = "h-11 w-full rounded-lg bg-white px-3 text-[15px] tnum border-[0.5px] border-ink-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint select-text";
const primary = "h-11 rounded-lg bg-brand text-brand-ink font-semibold cursor-pointer disabled:opacity-50 px-4";
const secondary = "h-11 rounded-lg border-[0.5px] border-ink-200 font-medium hover:bg-ink-50 cursor-pointer px-4";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className={`card p-5 w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto grid gap-4 content-start`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-3">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-900 cursor-pointer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The owner types their PIN on the till. It's checked on the server with the action it approves. */
export function PinPrompt({ title, onPin, onCancel }: { title: string; onPin: (pin: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4,6}$/.test(pin)) onPin(pin);
        }}
      >
        <p className="text-[13px] text-ink-600">Owner: enter your PIN. The cashier shouldn't see it.</p>
        <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={`${inputCls} text-center text-[24px] tracking-[0.5em]`} aria-label="Owner PIN" />
        <button className={primary} disabled={pin.length < 4}>Approve</button>
      </form>
    </Modal>
  );
}

type Dialog = null | "x" | "cash" | "returns" | "account" | "close";

export function MoreMenu(props: {
  registerId: number | null;
  role: Role;
  customer: TillCustomer | null;
  expenseAccounts: { code: string; name: string }[];
  onMessage: (m: string) => void;
  onCustomerChanged: (c: TillCustomer) => void;
  onShiftClosed: () => void;
  onExchange: (credit: ExchangeCredit, customer: TillCustomer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!props.registerId) return null;
  const registerId = props.registerId;
  const items: { key: Exclude<Dialog, null>; label: string; show: boolean }[] = [
    { key: "returns", label: "Returns & exchanges", show: true },
    { key: "account", label: "Payment on account", show: true },
    { key: "cash", label: "Cash in / out", show: true },
    { key: "x", label: "Shift so far (X-report)", show: true },
    { key: "close", label: "Close the till", show: true },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="text-ink-600 hover:text-ink-900 cursor-pointer">More ▾</button>
      {open && (
        <ul className="absolute right-0 top-7 z-40 card py-1 w-56">
          {items.filter((i) => i.show).map((i) => (
            <li key={i.key}><button onClick={() => { setDialog(i.key); setOpen(false); }} className="w-full text-left px-3 py-2 text-[13.5px] hover:bg-ink-50 cursor-pointer">{i.label}</button></li>
          ))}
        </ul>
      )}
      {dialog === "x" && <XReport registerId={registerId} onClose={() => setDialog(null)} />}
      {dialog === "cash" && <CashInOut registerId={registerId} expenseAccounts={props.expenseAccounts} onDone={(m) => { props.onMessage(m); setDialog(null); }} onClose={() => setDialog(null)} />}
      {dialog === "returns" && <Returns registerId={registerId} role={props.role} onMessage={props.onMessage} onExchange={(c, cust) => { setDialog(null); props.onExchange(c, cust); }} onClose={() => setDialog(null)} />}
      {dialog === "account" && <PayOnAccount registerId={registerId} customer={props.customer} onDone={(c, m) => { props.onCustomerChanged(c); props.onMessage(m); setDialog(null); }} onClose={() => setDialog(null)} />}
      {dialog === "close" && <CloseTill registerId={registerId} onClosed={props.onShiftClosed} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SummaryTable({ s }: { s: ShiftSummary }) {
  const row = (label: string, cents: number, strong = false) => (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}><span className="text-ink-600">{label}</span><span className="tnum">{kes(cents)}</span></div>
  );
  const TENDER: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", credit: "On account", points: "Points", exchange: "Exchange credit" };
  return (
    <div className="grid gap-1.5 text-[13.5px]">
      <div className="flex justify-between"><span className="text-ink-600">Sales</span><span className="tnum">{s.saleCount} · {kes(s.salesCents)}</span></div>
      {Object.entries(s.byTender).map(([m, c]) => row(`  ${TENDER[m] ?? m}`, c))}
      {s.discountsCents > 0 && row("Discounts & offers given", s.discountsCents)}
      {s.refunds.count > 0 && <div className="flex justify-between"><span className="text-ink-600">Returns</span><span className="tnum">{s.refunds.count}</span></div>}
      {Object.entries(s.refunds.byMethod).map(([m, c]) => row(`  Refunded ${TENDER[m] ?? m}`, -c))}
      {s.refunds.exchangesCents > 0 && row("  Exchanged", s.refunds.exchangesCents)}
      {Object.entries(s.creditPaymentsCents).map(([m, c]) => row(`Payments on account (${TENDER[m] ?? m})`, c))}
      {s.movements.map((m, i) => row(`Cash ${m.amountCents > 0 ? "in" : "out"}: ${m.note ?? m.reason.replace("_", " ")}`, m.amountCents))}
      <div className="hairline-t pt-1.5">{row("Opening float", s.openingFloatCents)}</div>
    </div>
  );
}

function XReport({ registerId, onClose }: { registerId: number; onClose: () => void }) {
  const [s, setS] = useState<ShiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    xReport(registerId).then((r) => (r.ok ? setS(r.data) : setError(r.error)));
  }, [registerId]);
  return (
    <Modal title="Shift so far" onClose={onClose}>
      {error ? <p className="text-bad text-[13px]">{error}</p> : !s ? <p className="text-ink-400 text-[13px]">Loading…</p> : (
        <>
          <p className="text-[12.5px] text-ink-400">Since {new Date(s.openedAt).toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" })}. This doesn't close the till.</p>
          <SummaryTable s={s} />
          <div className="flex justify-between text-[15px] font-semibold hairline-t pt-2"><span>Cash that should be in the drawer</span><span className="tnum">{kes(s.expectedCashCents)}</span></div>
        </>
      )}
    </Modal>
  );
}

function CashInOut({ registerId, expenseAccounts, onDone, onClose }: { registerId: number; expenseAccounts: { code: string; name: string }[]; onDone: (m: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState<"petty_expense" | "owner_drawing" | "to_bank" | "float_topup">("petty_expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expense, setExpense] = useState(expenseAccounts[0]?.code ?? "6900");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const REASONS = [
    { key: "petty_expense", label: "Paid an expense" },
    { key: "owner_drawing", label: "Owner took cash" },
    { key: "to_bank", label: "Taken to the bank" },
    { key: "float_topup", label: "Added change" },
  ] as const;
  return (
    <Modal title="Cash in / out of the drawer" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {REASONS.map((r) => (
          <button key={r.key} onClick={() => setReason(r.key)} className={`h-10 rounded-lg text-[13px] font-medium cursor-pointer border-[0.5px] ${reason === r.key ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200 hover:bg-ink-50"}`}>{r.label}</button>
        ))}
      </div>
      <label className="grid gap-1 text-[12.5px] text-ink-600">Amount (KES)<input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></label>
      {reason === "petty_expense" && (
        <label className="grid gap-1 text-[12.5px] text-ink-600">
          What kind of expense
          <select value={expense} onChange={(e) => setExpense(e.target.value)} className={inputCls}>
            {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>
        </label>
      )}
      <label className="grid gap-1 text-[12.5px] text-ink-600">Note{reason === "petty_expense" ? " (required)" : ""}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "petty_expense" ? "e.g. boda to pick stock" : ""} className={inputCls} /></label>
      {error && <p className="text-bad text-[13px]">{error}</p>}
      <button
        disabled={pending}
        className={primary}
        onClick={() => {
          const cents = parseKES(amount);
          if (Number.isNaN(cents) || cents <= 0) return setError("Enter an amount.");
          start(async () => {
            const r = await cashMovement(registerId, { reason, amountCents: cents, note, expenseAccountCode: reason === "petty_expense" ? expense : undefined });
            if (r.ok) onDone(`Recorded: ${REASONS.find((x) => x.key === reason)!.label}, KES ${kes(cents)}.`);
            else setError(r.error);
          });
        }}
      >
        {pending ? "Saving…" : reason === "float_topup" ? "Record cash in" : "Record cash out"}
      </button>
    </Modal>
  );
}

function PayOnAccount({ registerId, customer, onDone, onClose }: { registerId: number; customer: TillCustomer | null; onDone: (c: TillCustomer, m: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "mpesa">("mpesa");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!customer) {
    return <Modal title="Payment on account" onClose={onClose}><p className="text-[13.5px] text-ink-600">Find the customer by phone first (F4), then open this again.</p></Modal>;
  }
  return (
    <Modal title={`Payment from ${customer.businessName || customer.name || customer.phoneMasked}`} onClose={onClose}>
      <p className="text-[14px]">Owes <b className="tnum">KES {kes(customer.creditOwedCents)}</b></p>
      {customer.creditOwedCents <= 0 ? <p className="text-[13px] text-ink-400">Nothing is owed on this account.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["mpesa", "cash"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={`h-10 rounded-lg text-[13.5px] font-medium cursor-pointer border-[0.5px] ${method === m ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200"}`}>{m === "mpesa" ? "M-Pesa" : "Cash"}</button>
            ))}
          </div>
          <label className="grid gap-1 text-[12.5px] text-ink-600">Amount (KES)<input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kes(customer.creditOwedCents)} className={inputCls} /></label>
          {method === "mpesa" && <label className="grid gap-1 text-[12.5px] text-ink-600">M-Pesa code<input value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inputCls} uppercase tracking-widest`} /></label>}
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <button
            disabled={pending}
            className={primary}
            onClick={() => {
              const cents = amount.trim() ? parseKES(amount) : customer.creditOwedCents;
              if (Number.isNaN(cents) || cents <= 0) return setError("Enter an amount.");
              start(async () => {
                const r = await payOnAccount(registerId, { customerId: customer.id, amountCents: cents, method, mpesaCode: method === "mpesa" ? code : undefined });
                if (r.ok) onDone(r.data, `Received KES ${kes(cents)}. Still owes KES ${kes(r.data.creditOwedCents)}.`);
                else setError(r.error);
              });
            }}
          >
            {pending ? "Saving…" : "Record payment"}
          </button>
        </>
      )}
    </Modal>
  );
}

function Returns({ registerId, role, onMessage, onExchange, onClose }: { registerId: number; role: Role; onMessage: (m: string) => void; onExchange: (c: ExchangeCredit, customer: TillCustomer) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ReturnableSale[] | null>(null);
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [sealed, setSealed] = useState<Record<number, boolean>>({});
  const [kind, setKind] = useState<"exchange" | "refund">("exchange");
  const [refundMethod, setRefundMethod] = useState<"cash" | "mpesa" | "credit" | "points">("cash");
  const [askPin, setAskPin] = useState<null | ((pin: string) => void)>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idem = useRef(crypto.randomUUID());

  const picked = sale ? sale.lines.filter((l) => (qty[l.saleLineId] ?? 0) > 0) : [];
  const total = picked.reduce((s, l) => s + (qty[l.saleLineId] ?? 0) * l.unitPaidCents, 0);
  const allSealed = picked.length > 0 && picked.every((l) => sealed[l.saleLineId]);
  const ageHours = sale ? (Date.now() - Date.parse(sale.createdAt)) / 3_600_000 : 0;
  const needsOwner = role !== "owner" && (kind === "refund" || ageHours > 24);

  function submit(ownerPin?: string) {
    if (!sale) return;
    setError(null);
    start(async () => {
      const r = await returnItems({
        idempotencyKey: idem.current,
        registerId,
        saleId: sale.saleId,
        kind,
        refundMethod: kind === "refund" ? refundMethod : undefined,
        lines: picked.map((l) => ({ saleLineId: l.saleLineId, qty: qty[l.saleLineId] })),
        unopenedConfirmed: true,
        ownerPin,
      });
      if (!r.ok) return setError(r.error);
      if (kind === "exchange") {
        onExchange({ returnId: r.data.returnId, returnNo: r.data.returnNo, customerId: sale.customer.id, creditLeftCents: r.data.creditCents }, sale.customer);
      } else {
        onMessage(`Refund ${r.data.returnNo}: give back KES ${kes(r.data.totalCents)} by ${refundMethod === "mpesa" ? "M-Pesa" : refundMethod}.`);
        onClose();
      }
    });
  }

  if (askPin) {
    return <PinPrompt title={kind === "refund" ? "Owner approval for a refund" : "Owner approval for a late return"} onCancel={() => setAskPin(null)} onPin={(pin) => { const f = askPin; setAskPin(null); f(pin); }} />;
  }

  return (
    <Modal title="Returns & exchanges" onClose={onClose} wide>
      {!sale ? (
        <>
          <p className="text-[13px] text-ink-600">Only within 24 hours, and only unopened, unused items. A receipt or the customer's phone is needed.</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => { const r = await findSale(query); if (r.ok) { setFound(r.data); if (r.data.length === 1) setSale(r.data[0]); } else setError(r.error); }); }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Receipt KF-000123 or phone 07…" className={inputCls} />
            <button className={secondary} disabled={pending}>Find</button>
          </form>
          {found && found.length === 0 && <p className="text-[13px] text-ink-400">No sale found.</p>}
          {found && found.length > 1 && (
            <ul className="grid gap-1.5">
              {found.map((f) => (
                <li key={f.saleId}><button onClick={() => setSale(f)} className="w-full text-left rounded-lg border-[0.5px] border-ink-200 px-3 py-2 hover:bg-ink-50 cursor-pointer text-[13.5px]">{f.receiptNo} · {new Date(f.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })} · {f.lines.length} items</button></li>
              ))}
            </ul>
          )}
          {found?.some((f) => f.exchangeCredits.length > 0) && (
            <ExchangeCredits sale={found.find((f) => f.exchangeCredits.length > 0)!} role={role} onUse={onExchange} onMessage={onMessage} />
          )}
        </>
      ) : (
        <>
          <div className="flex justify-between text-[13px]">
            <span><b>{sale.receiptNo}</b> · {new Date(sale.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}</span>
            <button onClick={() => { setSale(null); setQty({}); setSealed({}); }} className="text-ink-600 cursor-pointer">Other sale</button>
          </div>
          {ageHours > 24 && <p className="text-[13px] text-warn">This sale is {Math.floor(ageHours)} hours old — past the 24-hour window. Only the owner can approve it.</p>}
          <ul className="grid gap-2">
            {sale.lines.map((l) => (
              <li key={l.saleLineId} className="rounded-lg border-[0.5px] border-ink-200 p-3 grid gap-2 text-[13.5px]">
                <div className="flex justify-between gap-3"><span className="font-medium">{l.description}</span><span className="tnum text-ink-600">{kes(l.unitPaidCents)} each</span></div>
                {l.returnable === 0 ? <span className="text-[12.5px] text-ink-400">Already returned</span> : (
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2">Return
                      <select value={qty[l.saleLineId] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [l.saleLineId]: Number(e.target.value) }))} className="h-9 rounded-md border-[0.5px] border-ink-200 px-2">
                        {Array.from({ length: l.returnable + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                      of {l.returnable}
                    </label>
                    {(qty[l.saleLineId] ?? 0) > 0 && (
                      <label className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={!!sealed[l.saleLineId]} onChange={(e) => setSealed((s) => ({ ...s, [l.saleLineId]: e.target.checked }))} />
                        Sealed — not opened or used
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setKind("exchange")} className={`h-11 rounded-lg text-[13.5px] font-medium cursor-pointer border-[0.5px] ${kind === "exchange" ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200"}`}>Exchange for other items</button>
            <button onClick={() => setKind("refund")} className={`h-11 rounded-lg text-[13.5px] font-medium cursor-pointer border-[0.5px] ${kind === "refund" ? "bg-brand text-brand-ink border-transparent" : "bg-white border-ink-200"}`}>Money back (owner)</button>
          </div>
          {kind === "refund" && (
            <label className="grid gap-1 text-[12.5px] text-ink-600">
              Give the money back by
              <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as typeof refundMethod)} className={inputCls}>
                <option value="cash">Cash from the drawer</option>
                <option value="mpesa">M-Pesa (send it from the till phone)</option>
                {sale.customer.creditEnabled && <option value="credit">Reduce what they owe on account</option>}
                {sale.customer.earnsPoints && <option value="points">Loyalty points</option>}
              </select>
            </label>
          )}
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <div className="flex justify-between items-center gap-3">
            <span className="text-[15px]">{kind === "exchange" ? "Credit" : "Refund"}: <b className="tnum">KES {kes(total)}</b></span>
            <button
              className={primary}
              disabled={pending || !allSealed}
              onClick={() => (needsOwner ? setAskPin(() => (pin: string) => submit(pin)) : submit())}
            >
              {pending ? "Saving…" : !picked.length ? "Pick items" : !allSealed ? "Confirm items are sealed" : kind === "exchange" ? "Give exchange credit" : "Refund"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Credit left from an earlier exchange: use it now, or (owner) pay it out. */
function ExchangeCredits({ sale, role, onUse, onMessage }: { sale: ReturnableSale; role: Role; onUse: (c: ExchangeCredit, customer: TillCustomer) => void; onMessage: (m: string) => void }) {
  const [pinFor, setPinFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payOut = (returnId: number, pin?: string) =>
    payOutExchangeCredit(returnId, "cash", pin).then((r) => (r.ok ? onMessage(`Paid out KES ${kes(r.data)} from the drawer.`) : setError(r.error)));
  if (pinFor !== null) return <PinPrompt title="Owner approval to pay out credit" onCancel={() => setPinFor(null)} onPin={(pin) => { const id = pinFor; setPinFor(null); payOut(id, pin); }} />;
  return (
    <div className="rounded-lg bg-ink-50 p-3 grid gap-2 text-[13.5px]">
      <span className="font-medium">Unused exchange credit</span>
      {sale.exchangeCredits.map((c) => (
        <div key={c.returnId} className="flex justify-between items-center gap-2">
          <span>{c.returnNo} · <b className="tnum">KES {kes(c.creditLeftCents)}</b></span>
          <span className="flex gap-2">
            <button className="text-brand-700 underline cursor-pointer" onClick={() => onUse({ returnId: c.returnId, returnNo: c.returnNo, customerId: sale.customer.id, creditLeftCents: c.creditLeftCents }, sale.customer)}>Use now</button>
            <button className="text-ink-600 underline cursor-pointer" onClick={() => (role === "owner" ? payOut(c.returnId) : setPinFor(c.returnId))}>Pay out cash</button>
          </span>
        </div>
      ))}
      {error && <p className="text-bad text-[12.5px]">{error}</p>}
    </div>
  );
}

const NOTES = [100_000, 50_000, 20_000, 10_000, 5_000] as const;
const COINS = [4_000, 2_000, 1_000, 500, 100] as const;

function CloseTill({ registerId, onClosed, onClose }: { registerId: number; onClosed: () => void; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ countedCents: number; expectedCents: number; varianceCents: number; summary: ShiftSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const counted = [...NOTES, ...COINS].reduce((s, d) => s + (Number(counts[d]) || 0) * d, 0);

  if (result) {
    const v = result.varianceCents;
    return (
      <Modal title="Till closed" onClose={onClosed} wide>
        <div className="grid gap-1 text-center">
          <span className="text-[13px] text-ink-400">Counted KES {kes(result.countedCents)} · expected KES {kes(result.expectedCents)}</span>
          <span className={`text-[34px] font-semibold tnum ${v === 0 ? "text-good" : v < 0 ? "text-bad" : "text-warn"}`}>{v === 0 ? "Balanced" : `${v < 0 ? "Short" : "Over"} KES ${kes(Math.abs(v))}`}</span>
        </div>
        <SummaryTable s={result.summary} />
        <p className="text-[12.5px] text-ink-400">The counted cash has been moved to “Cash at hand”. The owner will see this Z-report in the back office.</p>
        <button className={primary} onClick={onClosed}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Close the till — count the drawer" onClose={onClose} wide>
      <p className="text-[13px] text-ink-600">Count every note and coin. You'll see what the system expected only after you save.</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {[...NOTES, ...COINS].map((d) => (
          <label key={d} className="flex items-center justify-between gap-3 text-[14px]">
            <span className="tnum w-24">KES {(d / 100).toLocaleString("en-KE")}</span>
            <span className="text-ink-400">×</span>
            <input inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))} className="h-10 w-20 rounded-md bg-white px-2 text-right tnum border-[0.5px] border-ink-200" aria-label={`Number of KES ${d / 100}`} />
            <span className="tnum w-24 text-right text-ink-600">{kes((Number(counts[d]) || 0) * d)}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-between text-[16px] font-semibold hairline-t pt-2"><span>Counted</span><span className="tnum">KES {kes(counted)}</span></div>
      {error && <p className="text-bad text-[13px]">{error}</p>}
      <button
        className={primary}
        disabled={pending}
        onClick={() => start(async () => {
          const r = await endShift(registerId, Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0])));
          if (r.ok) setResult(r.data);
          else setError(r.error);
        })}
      >
        {pending ? "Closing…" : "Save count and close the till"}
      </button>
    </Modal>
  );
}
