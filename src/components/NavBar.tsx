"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/",              label: "Dashboard" },
  { href: "/positions",     label: "Positions" },
  { href: "/lessons",       label: "Lessons" },
  { href: "/signal-weights",label: "Signals" },
  { href: "/decisions",     label: "Decisions" },
  { href: "/scheduler",     label: "Scheduler" },
  { href: "/config",        label: "Config" },
  { href: "/secrets",       label: "API Keys" },
  { href: "/chat",          label: "Chat" },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const linkCls = (href: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return active
      ? "text-[var(--accent)] font-medium"
      : "text-[var(--muted)] hover:text-[var(--text)]";
  };

  return (
    <nav className="border-b border-[var(--border)] bg-[var(--bg)] sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center justify-between h-12">
        {/* Brand */}
        <a href="/" className="text-base font-bold text-[var(--accent)] shrink-0">
          Meridian
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-5 overflow-x-auto">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={`text-sm whitespace-nowrap transition-colors ${linkCls(l.href)}`}>
              {l.label}
            </a>
          ))}
        </div>

        {/* Hamburger */}
        <button
          className="md:hidden p-2 -mr-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
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

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--card)] px-4 py-3 flex flex-col gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`py-2.5 px-3 rounded-lg text-sm transition-colors ${
                pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
                  ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5"
              }`}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
