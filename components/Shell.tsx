"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  AlertOctagon,
  BarChart3,
  Building2,
  CircleDot,
  ClipboardList,
  Gauge,
  History,
  LogOut,
  MapPin,
  Menu,
  Route,
  Search,
  Settings,
  Truck,
  UserRound,
  Users,
  Waypoints,
  Wrench,
  X,
} from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import type { Permission } from "@/lib/rbac";
import { Spinner } from "./ui";

type Session = {
  user: { id: string; name: string; email: string } | null;
  organization: { id: string; name: string; currency: string; timezone: string; distanceUnit: string; weightUnit: string };
  role: string;
  permissions: Permission[];
};

const SessionContext = createContext<(Session & { can: (p: Permission) => boolean }) | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside the app shell");
  return session;
}

const NAV: { heading: string; items: { href: string; label: string; icon: typeof Gauge; permission?: Permission }[] }[] = [
  {
    heading: "Operate",
    items: [
      { href: "/command-center", label: "Command Center", icon: Gauge, permission: "shipments:read" },
      { href: "/orders", label: "Orders", icon: ClipboardList, permission: "orders:read" },
      { href: "/planning", label: "Planning", icon: Route, permission: "shipments:plan" },
      { href: "/shipments", label: "Shipments", icon: Waypoints, permission: "shipments:read" },
      { href: "/exceptions", label: "Exceptions", icon: AlertOctagon, permission: "exceptions:read" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics:read" },
    ],
  },
  {
    heading: "Network",
    items: [
      { href: "/customers", label: "Customers", icon: Building2, permission: "masterdata:read" },
      { href: "/locations", label: "Locations", icon: MapPin, permission: "masterdata:read" },
      { href: "/service-areas", label: "Service areas", icon: CircleDot, permission: "masterdata:read" },
      { href: "/carriers", label: "Carriers", icon: Truck, permission: "masterdata:read" },
      { href: "/vehicles", label: "Vehicles", icon: Truck, permission: "masterdata:read" },
      { href: "/maintenance", label: "Maintenance", icon: Wrench, permission: "masterdata:read" },
      { href: "/drivers", label: "Drivers", icon: UserRound, permission: "masterdata:read" },
    ],
  },
  {
    heading: "Administration",
    items: [
      { href: "/users", label: "Users & roles", icon: Users, permission: "users:manage" },
      { href: "/audit-log", label: "Audit log", icon: History, permission: "audit:read" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings:manage" },
    ],
  },
];

type Hit = { type: string; id: string; title: string; subtitle: string; href: string };

function CommandPalette({ onClose, can }: { onClose: () => void; can: (p: Permission) => boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: Hit[] }>(`/search?q=${encodeURIComponent(q)}`);
        if (!stale) {
          setHits(res.data);
          setActive(0);
        }
      } catch {
        if (!stale) setHits([]);
      }
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const pages: Hit[] = NAV.flatMap((g) => g.items)
    .filter((i) => !i.permission || can(i.permission))
    .filter((i) => !query.trim() || i.label.toLowerCase().includes(query.trim().toLowerCase()))
    .map((i) => ({ type: "Page", id: i.href, title: i.label, subtitle: "", href: i.href }));
  const results = [...hits, ...pages];

  const go = (hit: Hit) => {
    router.push(hit.href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center bg-zinc-900/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4">
          <Search className="h-4 w-4 text-zinc-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && results[active]) go(results[active]);
            }}
            placeholder="Search shipments, orders, carriers, vehicles…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            aria-label="Search"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">No matches for “{query.trim()}”</li>
          )}
          {results.map((hit, i) => (
            <li key={`${hit.type}-${hit.id}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === active && "bg-zinc-100")}
              >
                <span className="w-16 shrink-0 text-xs text-zinc-500">{hit.type}</span>
                <span className="font-medium text-zinc-900">{hit.title}</span>
                <span className="truncate text-zinc-500">{hit.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, error } = useApi<Session>("/auth/me");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setNavOpen(false), [pathname]);

  if (error && !session) {
    return <div className="p-10 text-sm text-red-700">Could not load your session: {error.message}</div>;
  }
  if (!session) return <Spinner />;

  const can = (permission: Permission) => session.permissions.includes(permission);
  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      <div className="px-2">
        <p className="truncate text-sm font-semibold text-zinc-900">{session.organization.name}</p>
        <p className="text-xs text-zinc-500">Transportation Management</p>
      </div>
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.heading}>
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">{group.heading}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                        current ? "bg-zinc-200/70 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="mt-auto border-t border-zinc-200 px-2 pt-3">
        <p className="truncate text-sm font-medium text-zinc-900">{session.user?.name}</p>
        <p className="truncate text-xs text-zinc-500">{session.user?.email}</p>
        <button type="button" onClick={logout} className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900">
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <SessionContext.Provider value={{ ...session, can }}>
      <div className="flex min-h-screen bg-zinc-50">
        <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-zinc-200 bg-zinc-50 lg:block">{sidebar}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-[900] bg-zinc-900/40 lg:hidden" onClick={() => setNavOpen(false)}>
            <aside className="h-full w-64 bg-zinc-50 shadow-xl" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
          <header className="sticky top-0 z-[800] flex h-12 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur">
            <button type="button" className="rounded p-1 text-zinc-600 hover:bg-zinc-100 lg:hidden" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">
              {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-sm text-zinc-500 hover:border-zinc-300"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              Search…
              <kbd className="ml-auto rounded border border-zinc-200 bg-white px-1.5 text-[10px] font-medium text-zinc-500">Ctrl K</kbd>
            </button>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} can={can} />}
    </SessionContext.Provider>
  );
}
