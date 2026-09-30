"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { brandPalette, mix } from "@/lib/brand";

/* Chart styling ported from the Zeno admin portal (AdminCharts), in the shop's brand colour. */

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const tooltipStyle = {
  borderRadius: "8px",
  border: "none",
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  fontSize: "12.5px",
  padding: "8px 12px",
};

const axisTick = { fontSize: 11.5, fill: "#86868b" };

const kes = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const short = (cents: number) => {
  const v = cents / 100;
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
};

/** Daily takings — accent area with a soft gradient. */
export function SalesTrendChart({ data, color }: { data: { label: string; cents: number; receipts: number }[]; color: string }) {
  const BRAND = brandPalette(color).brand;
  const mounted = useMounted();
  if (!mounted) return <div className="h-56 w-full bg-ink-50/40 rounded-lg animate-pulse" />;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity={0.22} />
              <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e8ee" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} interval="preserveStartEnd" />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} tickFormatter={short} width={44} domain={[0, (max: number) => max || 100_000]} />
          <Tooltip
            cursor={{ stroke: "#d5dbe3" }}
            contentStyle={tooltipStyle}
            formatter={(v, _n, item) => [`${kes(Number(v))} · ${(item?.payload as { receipts?: number })?.receipts ?? 0} receipts`, "Sales"]}
          />
          <Area type="monotone" dataKey="cents" stroke={BRAND} strokeWidth={2} fill="url(#salesFill)" dot={{ r: 3, fill: BRAND, strokeWidth: 0 }} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function tenderColors(color: string): Record<string, string> {
  const b = brandPalette(color).brand;
  return { cash: b, mpesa: mix(b, "#ffffff", 0.6), credit: mix(b, "#ffffff", 0.32), points: "#e3c9a6", exchange: "#d5dbe3" };
}

/** How customers paid — donut with the total in the middle. */
export function TenderDonut({ data, color }: { data: { method: string; label: string; cents: number }[]; color: string }) {
  const TENDER_COLORS = tenderColors(color);
  const mounted = useMounted();
  const total = data.reduce((s, d) => s + d.cents, 0);
  const shown = data.filter((d) => d.cents > 0);
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative h-44 w-44 shrink-0">
        {mounted && total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={shown} dataKey="cents" nameKey="label" innerRadius={56} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                {shown.map((d) => (
                  <Cell key={d.method} fill={TENDER_COLORS[d.method] ?? "#e3e8ee"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [kes(Number(v)), name]} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className={`h-44 w-44 rounded-full ${mounted ? "border-[24px] border-ink-100" : "bg-ink-50/40 animate-pulse"}`} />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[18px] font-semibold tnum leading-none">{short(total)}</div>
          <div className="text-[10.5px] text-ink-400 mt-1">KES</div>
        </div>
      </div>
      <ul className="space-y-2.5 text-[12.5px] min-w-[150px] flex-1">
        {data.map((d) => (
          <li key={d.method} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: TENDER_COLORS[d.method] ?? "#e3e8ee" }} />
            <span className="text-ink-600 whitespace-nowrap">{d.label}</span>
            <span className="ml-auto pl-3 font-medium tnum">{short(d.cents)}</span>
            <span className="text-ink-400 tnum w-9 text-right">{total ? Math.round((d.cents / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
