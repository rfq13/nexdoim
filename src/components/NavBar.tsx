"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

interface PendingItem {
  id: number;
  action: "deploy" | "close";
  pool_name: string | null;
  pool_address: string | null;
  reason: string | null;
  created_at: string;
  expires_at: string;
}

function formatAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}j`;
}

export default function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingItem[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/api/pending-decisions?status=pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const now = Date.now();
      setPending(
        (data.decisions ?? []).filter((d: any) => new Date(d.expires_at).getTime() > now)
      );
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadPending();
    const interval = setInterval(loadPending, 10_000);
    return () => clearInterval(interval);
  }, [loadPending]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close notif when navigating
  useEffect(() => { setNotifOpen(false); setMenuOpen(false); }, [pathname]);

  const count = pending.length;

  const linkCls = (href: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return active
      ? "text-(--accent) font-medium"
      : "text-(--muted) hover:text-(--text)";
  };

  const bellButton = (
    <button
      onClick={() => setNotifOpen((v) => !v)}
      className={`relative p-1.5 rounded-lg transition-colors ${
        notifOpen ? "text-(--accent) bg-(--accent)/10" : "text-(--muted) hover:text-(--text) hover:bg-white/5"
      }`}
      aria-label="Notifications"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold flex items-center justify-center animate-pulse">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );

  const notifDropdown = notifOpen && (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] overflow-y-auto bg-(--bg) border border-(--border) rounded-xl shadow-2xl z-50">
      {/* Dropdown header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-(--border)">
        <span className="text-sm font-semibold">Notifikasi</span>
        <a href="/pending" className="text-[10px] text-(--accent) hover:underline">
          Lihat semua →
        </a>
      </div>

      {/* Items */}
      {count === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-(--muted)">
          Tidak ada keputusan menunggu konfirmasi
        </div>
      ) : (
        <div className="divide-y divide-(--border)">
          {pending.map((d) => (
            <a
              key={d.id}
              href="/pending"
              className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
            >
              {/* Dot */}
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                d.action === "deploy" ? "bg-green-400" : "bg-red-400"
              }`} />
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-yellow-500/15 text-yellow-300 uppercase">
                    {d.action}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {d.pool_name ?? d.pool_address?.slice(0, 12) ?? "?"}
                  </span>
                </div>
                {d.reason && (
                  <div className="text-xs text-(--muted) mt-0.5 line-clamp-2">{d.reason}</div>
                )}
              </div>
              {/* Time */}
              <span className="text-[10px] text-(--muted) shrink-0 mt-0.5">
                {formatAgo(d.created_at)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <nav className="border-b border-(--border) bg-(--bg) sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center justify-between h-12">
        {/* Brand */}
        <a href="/" className="text-base font-bold text-(--accent) shrink-0">
          Meridian
        </a>

        {/* Desktop links + bell */}
        <div className="hidden md:flex items-center gap-5">
          <div className="flex items-center gap-5 min-w-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className={`text-sm whitespace-nowrap transition-colors ${linkCls(l.href)}`}>
                {l.label}
              </a>
            ))}
          </div>
          {/* Notification bell — outside overflow container so dropdown isn't clipped */}
          <div className="relative shrink-0" ref={notifRef}>
            {bellButton}
            {notifDropdown}
          </div>
        </div>

        {/* Mobile: bell + hamburger */}
        <div className="flex items-center gap-1 md:hidden">
          <div className="relative" ref={notifRef}>
            {bellButton}
            {notifDropdown}
          </div>
          <button
            className="p-2 -mr-2 text-(--muted) hover:text-(--text) transition-colors"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? (
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

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-(--border) bg-(--card) px-4 py-3 flex flex-col gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
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
            onClick={() => setMenuOpen(false)}
            className={`py-2.5 px-3 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              pathname === "/pending"
                ? "bg-(--accent)/10 text-(--accent) font-medium"
                : "text-(--muted) hover:text-(--text) hover:bg-white/5"
            }`}
          >
            Pending
            {count > 0 && (
              <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-[10px] font-bold flex items-center justify-center">
                {count}
              </span>
            )}
          </a>
        </div>
      )}
    </nav>
  );
}
