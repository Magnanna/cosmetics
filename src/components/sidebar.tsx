"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

export function Sidebar({ groups, shopName, userName, roleLabel }: { groups: NavGroup[]; shopName: string; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <>
      <div className="px-4 pt-5 pb-3 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-brand text-brand-ink grid place-items-center font-bold text-[15px]">K</div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold tracking-tight truncate">{shopName}</div>
          <div className="text-[11px] text-ink-400">Back office</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-md px-2 py-[7px] text-[13px] transition-colors ${
                      isActive(it.href) ? "bg-brand-tint text-brand-700 font-medium" : "text-ink-600 hover:bg-white/70 hover:text-ink-900"
                    }`}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="hairline-t px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium truncate">{userName}</div>
          <div className="text-[11px] text-ink-400">{roleLabel}</div>
        </div>
        <button onClick={signOut} className="text-[12px] text-ink-600 hover:text-ink-900 cursor-pointer">Sign out</button>
      </div>
    </>
  );

  return (
    <>
      <div className="md:hidden no-print sticky top-0 z-40 sidebar-chrome hairline-b h-14 flex items-center px-3 gap-3">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="w-9 h-9 grid place-items-center rounded-md hover:bg-white/70 cursor-pointer">☰</button>
        <span className="text-[14px] font-semibold">{shopName}</span>
      </div>
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] max-w-[85vw] bg-ink-50 flex flex-col shadow-xl">{nav}</aside>
        </div>
      )}
      <aside className="hidden md:flex sidebar-chrome no-print w-[228px] shrink-0 sticky top-0 h-screen flex-col border-r-[0.5px] border-ink-100">{nav}</aside>
    </>
  );
}
