import { prisma } from "./db";
import { log } from "./logger";

export async function isBlacklisted(mint: string | null | undefined): Promise<boolean> {
  if (!mint) return false;
  const entry = await prisma.tokenBlacklist.findUnique({ where: { mint } });
  return !!entry;
}

export async function addToBlacklist({ mint, symbol, reason }: { mint: string; symbol?: string; reason?: string }) {
  if (!mint) return { error: "mint required" };
  const existing = await prisma.tokenBlacklist.findUnique({ where: { mint } });
  if (existing) {
    return { already_blacklisted: true, mint, symbol: existing.symbol, reason: existing.reason };
  }
  await prisma.tokenBlacklist.create({
    data: { mint, symbol: symbol ?? "UNKNOWN", reason: reason ?? "no reason provided" },
  });
  log("blacklist", `Blacklisted ${symbol ?? mint}: ${reason}`);
  return { blacklisted: true, mint, symbol, reason };
}

export async function removeFromBlacklist({ mint }: { mint: string }) {
  if (!mint) return { error: "mint required" };
  const entry = await prisma.tokenBlacklist.findUnique({ where: { mint } });
  if (!entry) return { error: `Mint ${mint} not found on blacklist` };
  await prisma.tokenBlacklist.delete({ where: { mint } });
  log("blacklist", `Removed ${entry.symbol} from blacklist`);
  return { removed: true, mint, was: entry };
}

export async function listBlacklist() {
  const entries = await prisma.tokenBlacklist.findMany();
  return { count: entries.length, blacklist: entries };
}
