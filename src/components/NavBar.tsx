"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/",              label: "Dashboard" },
  { href: "/positions",     label: "Positions" },
  { href: "/lessons",       label: "Lessons" },
  { href: "/signal-weights",label: "Signals" },
  { href: "/decisions",     label: "Decisions" },
  { href: "/goals",         label: "Goals" },
  { href: "/scheduler",     label: "Scheduler" },
  { href: "/config",        label: "Config" },
  { href: "/secrets",       label: "API Keys" },
  { href: "/chat",          label: "Chat" },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await fetch("/api/pending-decisions?status=pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const now = Date.now();
      const active = (data.decisions ?? []).filter(
        (d: any) => new Date(d.expires_at).getTime() > now,
      );
      setPendingCount(active.length);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadPendingCount();
    const interval = setInterval(loadPendingCount, 10_000);
    return () => clearInterval(interval);
  }, [loadPendingCount]);

  const linkCls = (href: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return active
      ? "text-(--accent) font-medium"
      : "text-(--muted) hover:text-(--text)";
  };

  return (
    <nav className="border-b border-(--border) bg-(--bg) sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center justify-between h-12">
        {/* Brand */}
        <a href="/" className="text-base font-bold text-(--accent) shrink-0">
          Meridian
        </a>

        {/* Desktop links + bell */}
        <div className="hidden md:flex items-center gap-5 overflow-x-auto">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={`text-sm whitespace-nowrap transition-colors ${linkCls(l.href)}`}>
              {l.label}
            </a>
          ))}
          {/* Notification bell */}
          <a
            href="/pending"
            className={`relative p-1 rounded-lg transition-colors ${
              pathname === "/pending"
                ? "text-(--accent)"
                : "text-(--muted) hover:text-(--text)"
            }`}
            title={pendingCount > 0 ? `${pendingCount} pending decisions` : "Tidak ada pending"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold flex items-center justify-center animate-pulse">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </a>
        </div>

        {/* Mobile: bell + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <a
            href="/pending"
            className="relative p-2 text-(--muted) hover:text-(--text) transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold flex items-center justify-center animate-pulse">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </a>
          <button
            className="p-2 -mr-2 text-(--muted) hover:text-(--text) transition-colors"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-(--border) bg-(--card) px-4 py-3 flex flex-col gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`py-2.5 px-3 rounded-lg text-sm transition-colors ${
                pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
                  ? "bg-(--accent)/10 text-(--accent) font-medium"
                  : "text-(--muted) hover:text-(--text) hover:bg-white/5"
              }`}
            >
              {l.label}
            </a>
          ))}
          <a
            href="/pending"
            onClick={() => setOpen(false)}
            className={`py-2.5 px-3 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              pathname === "/pending"
                ? "bg-(--accent)/10 text-(--accent) font-medium"
                : "text-(--muted) hover:text-(--text) hover:bg-white/5"
            }`}
          >
            Pending
            {pendingCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-[10px] font-bold flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </a>
        </div>
      )}
    </nav>
  );
}
