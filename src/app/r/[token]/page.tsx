import { notFound } from "next/navigation";
import { getReceiptByToken } from "@/lib/receipt";
import { brandPalette } from "@/lib/brand";
import { cardTokenForReceipt } from "@/lib/loyalty-card";
import { AutoPrint } from "./auto-print";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

const money = (c: number) => `${Math.floor(Math.abs(c) / 100).toLocaleString("en-KE")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ print?: string }> }) {
  const [{ token }, { print }] = await Promise.all([params, searchParams]);
  const r = await getReceiptByToken(token);
  if (!r) notFound();
  const cardToken = r.customer.pointsBalance !== null ? await cardTokenForReceipt(token) : null;
  const when = new Date(r.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
  return (
    <main className="receipt mx-auto my-6 w-[80mm] max-w-full bg-white px-4 py-5 text-[12.5px] leading-snug text-black print:my-0 print:px-1 print:shadow-none shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <style>{`@page { size: 80mm auto; margin: 3mm; } @media print { html, body { background: white; } }`}</style>
      {print === "1" && <AutoPrint />}
      <div className="text-center grid gap-0.5 justify-items-center">
        {r.shop.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.shop.logoUrl} alt={r.shop.name} className="max-h-20 max-w-[60%] object-contain mb-1.5 print:grayscale" />
        )}
        <div className="text-[16px] font-bold print:!text-black" style={{ color: brandPalette(r.shop.brandColor).brand700 }}>{r.shop.name}</div>
        {r.shop.address && <div>{r.shop.address}</div>}
        {r.shop.phone && <div>Tel {r.shop.phone}</div>}
        {r.shop.kraPin && <div>PIN {r.shop.kraPin}</div>}
      </div>
      <div className="mt-3 flex justify-between"><span>Receipt {r.receiptNo}</span><span>{when}</span></div>
      <div className="flex justify-between"><span>Served by {r.cashier}</span><span>{r.customer.phoneMasked}</span></div>
      <hr className="my-2 border-dashed border-black" />
      {r.lines.map((l, i) => (
        <div key={i} className="mb-1.5">
          <div>{l.description}</div>
          <div className="flex justify-between tnum"><span>&nbsp;&nbsp;{l.qty} × {money(l.unitCents)}</span><span>{money(l.qty * l.unitCents)}</span></div>
          {l.discountCents > 0 && <div className="flex justify-between tnum"><span>&nbsp;&nbsp;Discount</span><span>-{money(l.discountCents)}</span></div>}
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      {r.discountCents > 0 && <div className="flex justify-between tnum"><span>Subtotal</span><span>{money(r.grossCents)}</span></div>}
      {r.discountCents > 0 && <div className="flex justify-between tnum"><span>Discount</span><span>-{money(r.discountCents)}</span></div>}
      <div className="flex justify-between text-[16px] font-bold tnum"><span>TOTAL KES</span><span>{money(r.totalCents)}</span></div>
      <div className="mt-2 grid gap-0.5">
        {r.payments.map((p, i) => (
          <div key={i}>
            {p.method === "cash" && <div className="flex justify-between tnum"><span>Cash</span><span>{money(p.tenderedCents ?? p.amountCents)}</span></div>}
            {p.method === "cash" && (p.changeCents ?? 0) > 0 && <div className="flex justify-between tnum"><span>Change</span><span>{money(p.changeCents!)}</span></div>}
            {p.method === "mpesa" && <div className="flex justify-between tnum"><span>M-Pesa {p.mpesaCode}</span><span>{money(p.amountCents)}</span></div>}
            {p.method === "credit" && <div className="flex justify-between tnum"><span>On account</span><span>{money(p.amountCents)}</span></div>}
            {p.method === "points" && <div className="flex justify-between tnum"><span>Paid with points</span><span>{money(p.amountCents)}</span></div>}
            {p.method === "exchange" && <div className="flex justify-between tnum"><span>Exchange credit</span><span>{money(p.amountCents)}</span></div>}
          </div>
        ))}
      </div>
      {r.customer.pointsBalance !== null && r.pointsEarned > 0 && (
        <div className="mt-2 flex justify-between tnum"><span>Points earned</span><span>{(r.pointsEarned / 100).toFixed(2)}</span></div>
      )}
      {r.customer.pointsBalance !== null && (
        <div className="flex justify-between tnum"><span>Points balance</span><span>{(r.customer.pointsBalance / 100).toFixed(2)}</span></div>
      )}
      {r.shop.footer && <p className="mt-3 text-center">{r.shop.footer}</p>}
      {cardToken && (
        <a href={`/c/${cardToken}`} className="print:hidden mt-4 block rounded-lg px-3 py-2.5 text-center text-[13px] font-semibold" style={{ background: brandPalette(r.shop.brandColor).brand, color: brandPalette(r.shop.brandColor).brandInk }}>
          View your loyalty card & points
        </a>
      )}
    </main>
  );
}
