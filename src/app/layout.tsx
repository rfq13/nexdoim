import type { Metadata } from "next";
import { cookies } from "next/headers";
import NavBar from "@/components/NavBar";
import "./globals.css";
// Auto-start the scheduler when the app is loaded in `next dev` mode.
// In production (`npm start`), server.ts also calls initCron() — the
// globalThis guard in initCron() makes the double-call a no-op.
import "@/lib/cron-auto-init";

export const metadata: Metadata = {
  title: "Meridian — DLMM LP Agent",
  description: "Autonomous DLMM liquidity provider agent for Meteora on Solana",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin_token")?.value === "authenticated";

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="antialiased min-h-screen">
        {isAuthenticated && <NavBar />}
        <main className="px-4 py-4 sm:px-6 sm:py-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
