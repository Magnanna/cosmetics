import { notFound } from "next/navigation";
import { getCard } from "@/lib/loyalty-card";
import { brandPalette, mix } from "@/lib/brand";
import { BrandStyle } from "@/components/brand-style";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false }, title: "Loyalty card" };

const kes = (c: number) => `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pts = (cp: number) => (cp / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "Africa/Nairobi" });

/** The customer's own card page — linked from their receipts. The token in the URL is the credential. */
export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await getCard(token);
  if (!card) notFound();
  const p = brandPalette(card.shop.brandColor);
  const canUse = card.pointsValueCents >= card.minRedeemCents;
  return (
    <main className="min-h-screen bg-ink-50 px-4 py-6 sm:py-10">
      <BrandStyle color={card.shop.brandColor} />
      <div className="mx-auto max-w-md grid gap-4">
        {/* The card */}
        <section
          className="relative overflow-hidden rounded-3xl p-6 text-brand-ink shadow-[0_12px_40px_rgba(0,0,0,0.18)] aspect-[1.586/1] flex flex-col justify-between"
          style={{ background: `linear-gradient(135deg, ${p.brand} 0%, ${mix(p.brand, "#000000", 0.72)} 100%)` }}
        >
          <div className="absolute -right-16 -top-16 size-56 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -right-4 top-24 size-40 rounded-full bg-white/5" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-3">
            {card.shop.logoUrl ? (
              <span className="h-12 max-w-[60%] rounded-xl bg-white/95 px-3 py-1.5 grid place-items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.shop.logoUrl} alt={card.shop.name} className="max-h-9 max-w-full object-contain" />
              </span>
            ) : (
              <span className="text-[18px] font-bold tracking-tight">{card.shop.name}</span>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">Loyalty card</span>
          </div>
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.14em] opacity-75">Points</div>
            <div className="text-[40px] font-semibold tracking-tight tnum leading-none mt-1">{card.earns ? pts(card.points) : "—"}</div>
            {card.earns && <div className="text-[13px] opacity-85 mt-1.5 tnum">Worth {kes(card.pointsValueCents)}</div>}
          </div>
          <div className="relative flex items-end justify-between gap-3 text-[12.5px]">
            <span className="font-medium truncate">{card.customer.name || "Valued customer"}</span>
            <span className="opacity-75 tnum">{card.customer.phoneMasked}</span>
          </div>
        </section>

        {/* Barcode to scan at the till */}
        <section className="card p-5 grid gap-2 justify-items-center">
          <div className="w-full max-w-[320px] [&_svg]:w-full [&_svg]:h-20" dangerouslySetInnerHTML={{ __html: card.barcodeSvg }} />
          <div className="text-[14px] font-medium tracking-[0.18em] tnum">{card.numberFormatted}</div>
          <p className="text-[12px] text-ink-400 text-center">Show this at the till to collect and use your points.</p>
        </section>

        {card.earns && (
          <section className="card p-5 grid gap-1.5">
            <h2 className="text-[13.5px] font-semibold">How your points work</h2>
            <p className="text-[13px] text-ink-600">You earn 1 point for every KES {card.earnKes.toLocaleString("en-KE")} you spend.</p>
            <p className="text-[13px] text-ink-600">
              {canUse ? <>You can use your points now — ask the cashier to pay with points.</> : <>Use them once they're worth {kes(card.minRedeemCents)} or more.</>}
            </p>
          </section>
        )}

        {card.offers.length > 0 && (
          <section className="card overflow-hidden">
            <h2 className="text-[13.5px] font-semibold px-5 pt-4 pb-3">Offers for you</h2>
            <ul className="divide-y divide-ink-100 border-t border-ink-100">
              {card.offers.map((o, i) => (
                <li key={i} className="px-5 py-3 grid gap-0.5">
                  <span className="text-[13.5px] font-medium text-brand-700">{o.title}</span>
                  {o.description && <span className="text-[12.5px] text-ink-600">{o.description}</span>}
                  <span className="text-[11.5px] text-ink-400">Until {day(o.endsAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
            <h2 className="text-[13.5px] font-semibold">Your purchases</h2>
            <span className="text-[11.5px] text-ink-400">{card.customer.visits} visit{card.customer.visits === 1 ? "" : "s"} · member since {day(card.customer.since)}</span>
          </div>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {card.recent.map((r) => (
              <li key={r.token}>
                <a href={`/r/${r.token}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-ink-50/60 transition-colors">
                  <span className="grid">
                    <span className="text-[13px] font-medium">{day(r.date)}</span>
                    <span className="text-[11px] text-ink-400">Receipt {r.receiptNo}{r.status !== "completed" ? " · returned" : ""}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] font-medium tnum">{kes(r.total)}</span>
                    {card.earns && r.points > 0 && <span className="block text-[11px] text-good tnum">+{pts(r.points)} pts</span>}
                  </span>
                </a>
              </li>
            ))}
            {card.recent.length === 0 && <li className="px-5 py-6 text-center text-[12.5px] text-ink-400">No purchases yet.</li>}
          </ul>
        </section>

        <p className="text-center text-[11.5px] text-ink-400">{card.shop.name}{card.shop.phone ? ` · ${card.shop.phone.replace(/^254/, "0")}` : ""}</p>
      </div>
    </main>
  );
}
