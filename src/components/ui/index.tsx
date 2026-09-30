import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-600 disabled:opacity-50",
  secondary: "bg-white text-ink-900 border-[0.5px] border-ink-200 hover:bg-ink-50 disabled:opacity-50",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-white text-bad border-[0.5px] border-ink-200 hover:bg-[#fbeeec]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-[13.5px]", lg: "h-12 px-5 text-[15px]" };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${sizes[size]} ${BUTTON[variant]} ${className}`}
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
        <h1 className="text-[26px] font-semibold tracking-tight leading-tight">{title}</h1>
        {subtitle && <div className="text-[13.5px] text-ink-400 mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[13px]">
      <span className="font-medium text-ink-600">{label}</span>
      {children}
      {error ? <span className="text-bad text-[12px]">{error}</span> : hint ? <span className="text-ink-400 text-[12px]">{hint}</span> : null}
    </label>
  );
}

const INPUT = "h-9 w-full rounded-md bg-white px-3 text-[14px] border-[0.5px] border-ink-200 placeholder:text-ink-400 focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-tint";

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
const PILL: Record<Tone, string> = {
  brand: "bg-brand-tint text-brand-700",
  good: "bg-[#e7f4ec] text-good",
  warn: "bg-[#fbf3df] text-[#8a6508]",
  bad: "bg-[#f8e8e6] text-bad",
  neutral: "bg-ink-50 text-ink-600 border-[0.5px] border-ink-200",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
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
