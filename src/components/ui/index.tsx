import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-600 shadow-[0_1px_2px_rgba(0,0,0,0.08)] disabled:opacity-60",
  secondary: "bg-white text-ink-600 border border-ink-200 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-60",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-60",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3 text-[12.5px]", md: "h-9 px-4 text-[13px]", lg: "h-12 px-5 text-[15px]" };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed ${sizes[size]} ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-ink-500 mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[13px] min-w-0">
      <span className="font-medium text-ink-600">{label}</span>
      {children}
      {error ? <span className="text-bad text-[12px]">{error}</span> : hint ? <span className="text-ink-400 text-[12px]">{hint}</span> : null}
    </label>
  );
}

const INPUT = "h-9 w-full min-w-0 rounded-lg bg-white px-3 text-[13.5px] border border-ink-200 placeholder:text-ink-400 transition-all focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${INPUT} pr-8 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${INPUT} h-auto py-2 ${className}`} {...props} />;
}

type Tone = "brand" | "good" | "warn" | "bad" | "neutral";
// Zeno admin badges: tinted fill, matching border, medium weight.
const PILL: Record<Tone, string> = {
  brand: "bg-brand-wash text-brand-700 border-brand-tint",
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  neutral: "bg-ink-50 text-ink-600 border-ink-200",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
}

/** Zeno admin KPI tile: small label, large quiet numeral, one line of context. */
export function Stat({ label, value, sub, subTone = "muted", className = "" }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: "good" | "bad" | "warn" | "muted"; className?: string }) {
  const tone = { good: "text-good", bad: "text-bad", warn: "text-warn", muted: "text-ink-400" }[subTone];
  return (
    <div className={`card p-5 min-w-0 ${className}`}>
      <div className="text-[12.5px] font-medium text-ink-400">{label}</div>
      <div className="stat-figure text-[clamp(1.2rem,1.1vw+0.75rem,1.625rem)] font-semibold tracking-tight tnum mt-1.5 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{value}</div>
      {sub && <div className={`text-[11.5px] mt-2 ${tone}`}>{sub}</div>}
    </div>
  );
}

/** Zeno admin panel: white card with a 13.5px title row and optional right-side link or note. */
export function Panel({ title, aside, className = "", bodyClassName = "p-5 pt-0", children }: { title: ReactNode; aside?: ReactNode; className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {aside && <div className="text-[11.5px] text-ink-400 shrink-0">{aside}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card p-10 grid justify-items-center gap-2 text-center">
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="text-[13.5px] text-ink-400 max-w-sm">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  const abs = Math.abs(cents);
  const s = `${cents < 0 ? "-" : ""}${Math.floor(abs / 100).toLocaleString("en-KE")}.${String(abs % 100).padStart(2, "0")}`;
  return <span className={`tnum ${className}`}>{s}</span>;
}
