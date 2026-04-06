import { prisma } from "./db";
import { log } from "./logger";

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function addSmartWallet({ name, address, category = "alpha", type = "lp" }: {
  name: string; address: string; category?: string; type?: string;
}) {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: "Invalid Solana address format" };
  }
  const existing = await prisma.smartWallet.findUnique({ where: { address } });
  if (existing) return { success: false, error: `Already tracked as "${existing.name}"` };

  await prisma.smartWallet.create({ data: { name, address, category, type } });
  log("smart_wallets", `Added wallet: ${name} (${category}, type=${type})`);
  return { success: true, wallet: { name, address, category, type } };
}

export async function removeSmartWallet({ address }: { address: string }) {
  const wallet = await prisma.smartWallet.findUnique({ where: { address } });
  if (!wallet) return { success: false, error: "Wallet not found" };
  await prisma.smartWallet.delete({ where: { address } });
  log("smart_wallets", `Removed wallet: ${wallet.name}`);
  return { success: true, removed: wallet.name };
}

export async function listSmartWallets() {
  const wallets = await prisma.smartWallet.findMany();
  return { total: wallets.length, wallets };
}

const _cache = new Map<string, { positions: unknown[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function checkSmartWalletsOnPool({ pool_address }: { pool_address: string }) {
  const allWallets = await prisma.smartWallet.findMany();
  const wallets = allWallets.filter((w) => !w.type || w.type === "lp");
  if (wallets.length === 0) {
    return {
      pool: pool_address, tracked_wallets: 0, in_pool: [],
      confidence_boost: false, signal: "No smart wallets tracked yet — neutral signal",
    };
  }

  const { getWalletPositions } = await import("./tools/dlmm");

  const results = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const cached = _cache.get(wallet.address);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { wallet, positions: cached.positions };
        }
        const { positions } = await getWalletPositions({ wallet_address: wallet.address });
        _cache.set(wallet.address, { positions: positions ?? [], fetchedAt: Date.now() });
        return { wallet, positions: positions ?? [] };
      } catch {
        return { wallet, positions: [] as unknown[] };
      }
    })
  );

  const inPool = results
    .filter((r) => (r.positions as Array<{ pool: string }>).some((p) => p.pool === pool_address))
    .map((r) => ({ name: r.wallet.name, category: r.wallet.category, address: r.wallet.address }));

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    signal: inPool.length > 0
      ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((w) => w.name).join(", ")} — STRONG signal`
      : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  };
}
