import { config } from "../config";
import { isBlacklisted } from "../token-blacklist";
import { isDevBlocked } from "../dev-blocklist";
import { log } from "../logger";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";

// ─── PVP Detection Constants ───────────────────────────────────
const PVP_SHORTLIST_LIMIT = 2;
const PVP_RIVAL_LIMIT     = 2;
const PVP_MIN_ACTIVE_TVL  = 5000;
const PVP_MIN_HOLDERS     = 500;
const PVP_MIN_GLOBAL_FEES_SOL = 30;

function normalizeSymbol(sym: string | undefined): string | null {
  if (!sym) return null;
  return sym.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function searchAssetsBySymbol(symbol: string): Promise<any[]> {
  const url = `https://token.jup.ag/strict?search=${encodeURIComponent(symbol)}&limit=10`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [data];
  } catch { return []; }
}

async function findRivalPool(mint: string): Promise<any | null> {
  const url = `https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(mint)}&sort_by=${encodeURIComponent("tvl:desc")}&filter_by=${encodeURIComponent(`tvl>${PVP_MIN_ACTIVE_TVL}`)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pools = Array.isArray(data?.data) ? data.data : [];
    return pools.find((pool: any) => pool?.token_x?.address === mint || pool?.token_y?.address === mint) || null;
  } catch { return null; }
}

/**
 * Enrich top pool candidates with PVP (Pool vs Pool) risk flags.
 * Detects if the same token symbol has an established rival pool.
 * Mutates pool objects in-place (adds is_pvp, pvp_risk, pvp_rival_* fields).
 */
async function enrichPvpRisk(pools: any[]): Promise<void> {
  const shortlist = [...pools]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, PVP_SHORTLIST_LIMIT);

  if (shortlist.length === 0) return;

  const symbolCache = new Map<string, any[]>();

  await Promise.all(shortlist.map(async (pool) => {
    const symbol  = normalizeSymbol(pool.base?.symbol);
    const ownMint = pool.base?.mint;
    if (!symbol || !ownMint) return;

    let assets = symbolCache.get(symbol);
    if (!assets) {
      assets = await searchAssetsBySymbol(symbol).catch(() => []);
      symbolCache.set(symbol, assets);
    }

    const rivalAssets = (assets || [])
      .filter((asset: any) => normalizeSymbol(asset?.symbol) === symbol && asset?.id && asset.id !== ownMint)
      .sort((a: any, b: any) => Number(b?.liquidity || 0) - Number(a?.liquidity || 0))
      .slice(0, PVP_RIVAL_LIMIT);

    for (const rival of rivalAssets) {
      const rivalHolders = Number(rival?.holderCount || 0);
      const rivalFees    = Number(rival?.fees || 0);
      if (rivalHolders < PVP_MIN_HOLDERS || rivalFees < PVP_MIN_GLOBAL_FEES_SOL) continue;

      const rivalPool = await findRivalPool(rival.id).catch(() => null);
      if (!rivalPool) continue;

      pool.is_pvp           = true;
      pool.pvp_risk         = "high";
      pool.pvp_symbol       = pool.base?.symbol || symbol;
      pool.pvp_rival_name   = rival?.name || pool.pvp_symbol;
      pool.pvp_rival_mint   = rival.id;
      pool.pvp_rival_pool   = rivalPool.address;
      pool.pvp_rival_tvl    = round(Number(rivalPool.tvl || 0));
      pool.pvp_rival_holders = rivalHolders;
      pool.pvp_rival_fees   = Number(rivalFees.toFixed(2));
      log("screening", `PVP guard: ${pool.name} has active rival ${pool.pvp_rival_name} (${rival.id.slice(0, 8)})`);
      break;
    }
  }));
}

function scoreCandidate(p: any): number {
  return (p.fee_active_tvl_ratio ?? 0) * 100 + (p.organic_score ?? 0) * 0.1;
}

// ─── Pool Discovery ────────────────────────────────────────────

export async function discoverPools({ page_size = 50 } = {}) {
  const s = config.screening;
  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${s.minMcap}`,
    `base_token_market_cap<=${s.maxMcap}`,
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    `tvl<=${s.maxTvl}`,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    "quote_token_organic_score>=60",
  ].join("&&");

  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=${page_size}&filter_by=${encodeURIComponent(filters)}&timeframe=${s.timeframe}&category=${s.category}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const pools = [];
  for (const p of (data.data || []).map(condensePool)) {
    if (await isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} in pool ${p.name}`);
      continue;
    }
    // Dev blocklist check (dev wallet from pool data; field may be absent in condensed form)
    if (p.dev && await isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered dev-blocked pool ${p.name} (dev: ${p.dev?.slice(0, 8)})`);
      continue;
    }
    pools.push(p);
  }

  return { total: data.total, pools };
}

export async function getTopCandidates({ limit = 10 } = {}) {
  const { pools } = await discoverPools({ page_size: 50 });
  const { getMyPositions } = await import("./dlmm");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((p: any) => p.pool));
  const occupiedMints = new Set(positions.map((p: any) => p.base_mint).filter(Boolean));

  let eligible = pools
    .filter((p: any) => !occupiedPools.has(p.pool) && !occupiedMints.has(p.base?.mint));

  // PVP detection: flag pools competing with established rival pools
  if (config.screening.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible).catch(() => {});
    if (config.screening.blockPvpSymbols) {
      const before = eligible.length;
      eligible = eligible.filter((p: any) => {
        if (p.is_pvp) {
          log("screening", `PVP hard filter: removed ${p.name} (rival: ${p.pvp_rival_name})`);
          return false;
        }
        return true;
      });
      if (eligible.length < before) {
        log("screening", `PVP hard filter removed ${before - eligible.length} pool(s)`);
      }
    }
  }

  // Multi-timeframe validation: cross-check top candidates against 1h timeframe
  const validated = await validateMultiTimeframe(eligible.slice(0, Math.min(limit * 2, 20)));

  return { candidates: validated.slice(0, limit), total_screened: pools.length };
}

async function validateMultiTimeframe(pools: any[]): Promise<any[]> {
  if (pools.length === 0) return [];
  const s = config.screening;

  try {
    const filters = `pool_type=dlmm`;
    const url = `${POOL_DISCOVERY_BASE}/pools?page_size=50&filter_by=${encodeURIComponent(filters)}&timeframe=1h&category=${s.category}`;
    const res = await fetch(url);
    if (!res.ok) return pools;

    const data = await res.json();
    const hourlyPools = new Map<string, any>();
    for (const p of (data.data || [])) {
      hourlyPools.set(p.pool_address, p);
    }

    return pools
      .map((pool: any) => {
        const hourly = hourlyPools.get(pool.pool);
        const mtfScore = hourly
          ? (hourly.fee_active_tvl_ratio >= s.minFeeActiveTvlRatio ? 1 : 0)
            + (hourly.volume >= s.minVolume ? 1 : 0)
            + ((hourly.price_change_percentage ?? 0) > -10 ? 1 : 0)
          : 0;
        return { ...pool, mtf_score: mtfScore, mtf_validated: mtfScore >= 2 };
      })
      .sort((a: any, b: any) => b.mtf_score - a.mtf_score);
  } catch {
    return pools;
  }
}

export async function getPoolDetail({ pool_address, timeframe = "5m" }: { pool_address: string; timeframe?: string }) {
  const s = config.screening;
  const filters = `pool_type=dlmm`;
  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=50&filter_by=${encodeURIComponent(filters)}&timeframe=${timeframe}&category=${s.category}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status}`);
  const data = await res.json();
  const pool = (data.data || []).find((p: any) => p.pool_address === pool_address);
  if (!pool) return { error: `Pool ${pool_address} not found in top 50` };
  return condensePool(pool);
}

function condensePool(p: any) {
  return {
    pool: p.pool_address,
    name: p.pool_name || `${p.base_token_symbol}-${p.quote_token_symbol}`,
    base: { symbol: p.base_token_symbol, mint: p.base_token_mint, mcap: p.base_token_market_cap },
    quote: { symbol: p.quote_token_symbol, mint: p.quote_token_mint },
    bin_step: p.dlmm_bin_step,
    fee_pct: p.base_fee_percentage,
    active_tvl: Math.round(p.active_tvl || p.tvl || 0),
    fee_window: Math.round((p.fees || 0) * 100) / 100,
    volume_window: Math.round(p.volume || 0),
    fee_active_tvl_ratio: p.fee_active_tvl_ratio,
    volatility: p.volatility,
    organic_score: p.base_token_organic_score,
    mcap: Math.round(p.base_token_market_cap || 0),
    holders: p.base_token_holders,
    active_positions: p.active_positions,
    price_change_pct: p.price_change_percentage,
    volume: Math.round(p.volume || 0),
    dev: p.base_token_deployer || p.deployer || null,
  };
}
