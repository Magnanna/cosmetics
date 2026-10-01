"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BadgePercent,
  BookLock,
  BookOpen,
  Boxes,
  ClipboardCheck,
  FileText,
  History,
  House,
  KeyRound,
  Landmark,
  LayoutGrid,
  ListTree,
  MessageSquareText,
  NotebookPen,
  PackageOpen,
  PanelLeft,
  Receipt,
  ScrollText,
  ShoppingCart,
  Search,
  SlidersHorizontal,
  Smartphone,
  Store,
  Tag,
  Tags,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { forgetTillUser } from "@/app/till/actions";
import {
  AnimatedSidebar,
  AnimatedSidebarClose,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarHeader,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
} from "@/components/motion/animated-sidebar";

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

// Icons live here (not in the server layout) because components can't cross the server/client boundary.
const ICONS: Record<string, LucideIcon> = {
  "/": House,
  "/till": Store,
  "/sales/history": Receipt,
  "/sales/shifts": Wallet,
  "/customers": Users,
  "/offers": BadgePercent,
  "/products": LayoutGrid,
  "/products/brands": Tags,
  "/products/categories": ListTree,
  "/products/prices": Tag,
  "/stock/receive": PackageOpen,
  "/stock/bills": FileText,
  "/stock/reorder": ShoppingCart,
  "/stock/counts": ClipboardCheck,
  "/stock/adjust": SlidersHorizontal,
  "/suppliers": Truck,
  "/money/transfers": ArrowLeftRight,
  "/money/expenses": Wallet,
  "/money/mpesa": Smartphone,
  "/reports": BookOpen,
  "/reports/tot": Landmark,
  "/money/journal": NotebookPen,
  "/books/accounts": Boxes,
  "/settings/shop": Store,
  "/settings/team": UserCog,
  "/settings/opening": Wand2,
  "/settings/books": BookLock,
  "/settings/activity": History,
  "/settings/pin": KeyRound,
  "/settings/messages": MessageSquareText,
};

/** Must render inside a PersistentSidebarProvider (see (app)/layout.tsx). */
export function Sidebar({ groups, shopName, logoUrl, userName, roleLabel }: { groups: NavGroup[]; shopName: string; logoUrl: string | null; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();

  // Longest matching href wins, so the shared sliding pill has a single target.
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((it) => (it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  async function signOut() {
    await forgetTillUser();
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <div className="md:hidden no-print fixed top-0 inset-x-0 z-40 px-3 pt-3">
        <div className="relative sidebar-chrome rounded-[32px] shadow-[0_2px_14px_rgba(0,0,0,0.08)] border border-ink-100/70 h-16 flex items-center justify-center">
          <AnimatedSidebarTrigger aria-label="Open menu" className="absolute left-2.5 size-10 rounded-full text-ink-900 hover:bg-white/60">
            <PanelLeft aria-hidden="true" className="size-5" />
          </AnimatedSidebarTrigger>
          <div className="flex flex-col items-center leading-tight max-w-[55vw]">
            <span className="text-[14px] font-semibold tracking-tight truncate">{shopName}</span>
            <span className="text-[11px] text-ink-400 mt-0.5 truncate">Back office</span>
          </div>
        </div>
      </div>

      <AnimatedSidebar
        ariaLabel="Main navigation"
        collapsible="icon"
        className="no-print"
        panelClassName="bg-[rgba(246,249,252,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.4] border-ink-100"
      >
        <AnimatedSidebarHeader className="px-4 pt-5 pb-3 group-data-[state=collapsed]/sidebar:px-3">
          <div className="flex items-center gap-2.5 group-data-[state=collapsed]/sidebar:flex-col">
            <div className="shrink-0 w-14 h-14 group-data-[state=collapsed]/sidebar:size-11 rounded-xl overflow-hidden flex items-center justify-center bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] border border-ink-100">
              <ShopMark shopName={shopName} logoUrl={logoUrl} className="text-[22px] group-data-[state=collapsed]/sidebar:text-[18px]" />
            </div>
            <div className="min-w-0 flex-1 group-data-[state=collapsed]/sidebar:hidden">
              <div className="text-[13.5px] font-semibold tracking-tight truncate leading-tight">{shopName}</div>
              <div className="text-[10.5px] text-ink-400 mt-0.5">Back office</div>
            </div>
            <AnimatedSidebarTrigger
              aria-label="Toggle sidebar (Ctrl/⌘ B)"
              title="Toggle sidebar (Ctrl/⌘ B)"
              className="hidden md:inline-flex size-8 rounded-lg text-ink-400 hover:bg-white/60 hover:text-ink-800"
            >
              <PanelLeft aria-hidden="true" className="size-4" />
            </AnimatedSidebarTrigger>
            <AnimatedSidebarClose className="ml-auto size-8 text-[18px] text-ink-600 hover:bg-white/70 md:hidden">×</AnimatedSidebarClose>
          </div>
          <div className="mt-3 group-data-[state=collapsed]/sidebar:hidden">
            <NavSearch groups={groups} />
          </div>
        </AnimatedSidebarHeader>

        <AnimatedSidebarContent className="px-3 py-2">
          {groups.map((g, gi) => (
            <AnimatedSidebarGroup key={g.label} className="px-0 py-1">
              {gi > 0 && <AnimatedSidebarGroupLabel className="h-6 text-[10.5px] font-semibold tracking-wider">{g.label}</AnimatedSidebarGroupLabel>}
              <AnimatedSidebarGroupContent>
                <AnimatedSidebarMenu>
                  {g.items.map((it) => {
                    const Icon = ICONS[it.href] ?? ScrollText;
                    const active = it.href === activeHref;
                    return (
                      <AnimatedSidebarMenuItem key={it.href}>
                        <AnimatedSidebarMenuButton
                          href={it.href}
                          isActive={active}
                          icon={<Icon aria-hidden="true" strokeWidth={1.75} className="size-[17px] opacity-80" />}
                          className={`min-h-[34px] rounded-md text-[13px] ${active ? "text-brand-700" : "text-ink-600"}`}
                        >
                          {it.label}
                        </AnimatedSidebarMenuButton>
                      </AnimatedSidebarMenuItem>
                    );
                  })}
                </AnimatedSidebarMenu>
              </AnimatedSidebarGroupContent>
            </AnimatedSidebarGroup>
          ))}
        </AnimatedSidebarContent>

        <AnimatedSidebarFooter className="hairline-t border-t-0 px-4 py-3 group-data-[state=collapsed]/sidebar:px-1">
          <div className="flex items-center justify-between gap-2 group-data-[state=collapsed]/sidebar:justify-center">
            <div className="min-w-0 group-data-[state=collapsed]/sidebar:hidden">
              <div className="text-[12.5px] font-medium truncate">{userName}</div>
              <div className="text-[11px] text-ink-400">{roleLabel}</div>
            </div>
            <button onClick={signOut} aria-label="Sign out" className="text-[12px] text-ink-400 hover:text-bad transition-colors cursor-pointer shrink-0">
              Sign out
            </button>
          </div>
        </AnimatedSidebarFooter>

        <AnimatedSidebarRail />
      </AnimatedSidebar>
    </>
  );
}

/** The shop's logo, or its first letter in the brand colour when there is none. */
export function ShopMark({ shopName, logoUrl, className = "" }: { shopName: string; logoUrl: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (logoUrl) return <img src={logoUrl} alt={shopName} className="w-full h-full object-contain p-1" />;
  return <span className={`font-bold tracking-tight text-brand ${className}`}>{shopName.slice(0, 1).toUpperCase() || "K"}</span>;
}

/** Zeno-style pill search in the sidebar header: jump to any page you can open. */
function NavSearch({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label }))).filter((it) => `${it.label} ${it.group}`.toLowerCase().includes(t)).slice(0, 7);
  }, [q, groups]);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="relative w-full" ref={ref} onBlur={(e) => !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <div className="relative flex items-center">
        <Search aria-hidden="true" className="absolute left-3 size-3.5 text-ink-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0].href);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Jump to…"
          aria-label="Jump to a page"
          className="w-full h-8 pl-8 pr-3 rounded-full bg-white border border-ink-200 text-[12.5px] outline-none focus:border-brand-ring focus:ring-2 focus:ring-brand-tint transition-all placeholder:text-ink-400"
        />
      </div>
      {open && q.trim() && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-lg shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] border border-ink-100 py-1.5 z-50 overflow-hidden animate-[zeno-pop_0.16s_ease-out]">
          {results.length === 0 ? (
            <div className="px-3.5 py-2 text-[12px] text-ink-400">No page matches “{q.trim()}”.</div>
          ) : (
            results.map((r) => (
              <Link key={r.href} href={r.href} onClick={() => go(r.href)} className="flex flex-col px-3.5 py-2 hover:bg-ink-50 transition-colors">
                <span className="text-[12.5px] font-medium text-ink-900 truncate">{r.label}</span>
                <span className="text-[10.5px] text-ink-400 truncate mt-0.5">{r.group}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
