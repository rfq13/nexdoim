import { supabase } from "./db";
import { log } from "./logger";

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function addSmartWallet({
  name,
  address,
  category = "alpha",
  type = "lp",
}: {
  name: string;
  address: string;
  category?: string;
  type?: string;
}) {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: "Invalid Solana address format" };
  }

  const { data: existing, error } = await supabase
    .from("smart_wallets")
    .select("name")
    .eq("address", address)
    .maybeSingle();

  if (error) throw error;
  if (existing)
    return { success: false, error: `Already tracked as "${existing.name}"` };

  const { error: insertError } = await supabase
    .from("smart_wallets")
    .insert({ name, address, category, type });
  if (insertError) throw insertError;

  log("smart_wallets", `Added wallet: ${name} (${category}, type=${type})`);
  return { success: true, wallet: { name, address, category, type } };
}

export async function removeSmartWallet({ address }: { address: string }) {
  const { data: wallet, error } = await supabase
    .from("smart_wallets")
    .select("name")
    .eq("address", address)
    .maybeSingle();

  if (error) throw error;
  if (!wallet) return { success: false, error: "Wallet not found" };

  const { error: deleteError } = await supabase
    .from("smart_wallets")
    .delete()
    .eq("address", address);
  if (deleteError) throw deleteError;

  log("smart_wallets", `Removed wallet: ${wallet.name}`);
  return { success: true, removed: wallet.name };
}

export async function listSmartWallets() {
  const { data: walletsData, error } = await supabase
    .from("smart_wallets")
    .select("*");
  if (error) throw error;
  const wallets = walletsData ?? [];
  return { total: wallets.length, wallets };
}

const _cache = new Map<string, { positions: unknown[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function checkSmartWalletsOnPool({
  pool_address,
}: {
  pool_address: string;
}) {
  const { data: allWalletsData, error } = await supabase
    .from("smart_wallets")
    .select("*");
  if (error) throw error;
  const allWallets = allWalletsData ?? [];

  const wallets = allWallets.filter(
    (wallet: any) => !wallet.type || wallet.type === "lp",
  );
  if (wallets.length === 0) {
    return {
      pool: pool_address,
      tracked_wallets: 0,
      in_pool: [],
      confidence_boost: false,
      signal: "No smart wallets tracked yet — neutral signal",
    };
  }

  const { getWalletPositions } = await import("./tools/dlmm");

  const results = await Promise.all(
    wallets.map(async (wallet: any) => {
      try {
        const cached = _cache.get(wallet.address);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { wallet, positions: cached.positions };
        }
        const { positions } = await getWalletPositions({
          wallet_address: wallet.address,
        });
        _cache.set(wallet.address, {
          positions: positions ?? [],
          fetchedAt: Date.now(),
        });
        return { wallet, positions: positions ?? [] };
      } catch {
        return { wallet, positions: [] as unknown[] };
      }
    }),
  );

  const inPool = results
    .filter((result) =>
      (result.positions as Array<{ pool: string }>).some(
        (position) => position.pool === pool_address,
      ),
    )
    .map((result) => ({
      name: result.wallet.name,
      category: result.wallet.category,
      address: result.wallet.address,
    }));

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    signal:
      inPool.length > 0
        ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((wallet) => wallet.name).join(", ")} — STRONG signal`
        : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  };
}
