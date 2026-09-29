import Link from "next/link";
import type { Section } from "@/lib/reports";
import { Money } from "./ui";

/** Date-range picker as a plain GET form, so every report view is a shareable link. */
export function RangeForm({ from, to, extra, exportHref }: { from?: string; to: string; extra?: React.ReactNode; exportHref?: string }) {
  return (
    <form className="flex flex-wrap items-end gap-2 mb-5 no-print">
      {from !== undefined && (
        <label className="grid gap-1 text-[12px] text-ink-400">From<input type="date" name="from" defaultValue={from} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200" /></label>
      )}
      <label className="grid gap-1 text-[12px] text-ink-400">{from !== undefined ? "To" : "As at"}<input type="date" name={from !== undefined ? "to" : "asOf"} defaultValue={to} className="h-9 rounded-md bg-white px-2 text-[13.5px] border-[0.5px] border-ink-200" /></label>
      {extra}
      <button className="h-9 px-4 rounded-md bg-brand text-brand-ink text-[13px] font-medium cursor-pointer">Show</button>
      {exportHref && <a href={exportHref} className="h-9 px-3 rounded-md border-[0.5px] border-ink-200 text-[13px] grid place-items-center hover:bg-ink-50">Download CSV</a>}
    </form>
  );
}

export function SectionTable({ section, from, to, negate }: { section: Section; from?: string; to: string; negate?: boolean }) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 pt-3">{section.label}</div>
      {section.lines.length === 0 && <div className="text-[13px] text-ink-400">—</div>}
      {section.lines.map((l) => (
        <div key={l.accountId} className="flex justify-between text-[13.5px]">
          <Link href={`/reports/ledger/${l.accountId}?from=${from ?? "2000-01-01"}&to=${to}`} className="hover:underline">{l.name}</Link>
          <Money cents={negate ? -l.cents : l.cents} />
        </div>
      ))}
    </div>
  );
}

export function TotalRow({ label, cents, strong, tone }: { label: string; cents: number; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={`flex justify-between hairline-t pt-2 mt-1 ${strong ? "text-[16px] font-semibold" : "text-[14px] font-medium"} ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>
      <span>{label}</span>
      <Money cents={cents} />
    </div>
  );
}

export function monthStart(d: string) {
  return `${d.slice(0, 8)}01`;
}
export const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
