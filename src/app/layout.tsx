import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian — DLMM LP Agent",
  description: "Autonomous DLMM liquidity provider agent for Meteora on Solana",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <nav className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-6">
          <a href="/" className="text-lg font-bold text-[var(--accent)]">Meridian</a>
          <a href="/" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">Dashboard</a>
          <a href="/positions" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">Positions</a>
          <a href="/lessons" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">Lessons</a>
          <a href="/config" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">Config</a>
          <a href="/secrets" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">API Keys</a>
          <a href="/chat" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">Chat</a>
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
