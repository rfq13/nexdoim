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

  // Only use filters that the upstream API still honors under its current
  // schema. Upstream silently ignores unknown filter fields, so any filter
  // pointing at a deprecated field (e.g. `base_token_market_cap`,
  // `dlmm_bin_step`) would let every pool through. All token-level and
  // bin-level filters are applied client-side after we condense the pool.
  const filters = [
    "pool_type=dlmm",
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    `tvl<=${s.maxTvl}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
  ].join("&&");

  // Fetch a larger window than requested so we still have enough candidates
  // after client-side filtering on mcap / organic / bin_step.
  const fetchSize = Math.max(page_size * 2, 100);
  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=${fetchSize}&filter_by=${encodeURIComponent(filters)}&timeframe=${s.timeframe}&category=${s.category}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const rawPools = (data.data || []).map(condensePool);
  const pools = [];
  let droppedMcap = 0, droppedOrganic = 0, droppedHolders = 0, droppedBinStep = 0;

  for (const p of rawPools) {
    // Client-side filters (formerly done upstream)
    if (p.mcap != null && (p.mcap < s.minMcap || p.mcap > s.maxMcap)) { droppedMcap++; continue; }
    if (p.organic_score != null && p.organic_score < s.minOrganic) { droppedOrganic++; continue; }
    if (p.holders != null && p.holders < s.minHolders) { droppedHolders++; continue; }
    if (p.bin_step != null && (p.bin_step < s.minBinStep || p.bin_step > s.maxBinStep)) { droppedBinStep++; continue; }
    // Pools with completely missing mcap/organic are kept but flagged — the
    // agent's prompt already penalizes unknown signals.

    if (await isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} in pool ${p.name}`);
      continue;
    }
    if (p.dev && await isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered dev-blocked pool ${p.name} (dev: ${p.dev?.slice(0, 8)})`);
      continue;
    }
    pools.push(p);
  }

  log("screening", `discoverPools: ${rawPools.length} fetched → ${pools.length} eligible (dropped mcap=${droppedMcap}, organic=${droppedOrganic}, holders=${droppedHolders}, bin_step=${droppedBinStep})`);
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
    const url = `${POOL_DISCOVERY_BASE}/pools?page_size=100&filter_by=${encodeURIComponent(filters)}&timeframe=1h&category=${s.category}`;
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
        const priceChange5m = pool.price_change_pct ?? 0;
        const priceChange1h = hourly?.pool_price_change_pct ?? hourly?.price_change_percentage ?? 0;

        // Momentum scoring: count positive timeframes
        const trend5m = priceChange5m > 0 ? 1 : priceChange5m < -5 ? -1 : 0;
        const trend1h = priceChange1h > 0 ? 1 : priceChange1h < -10 ? -1 : 0;
        const trendScore = trend5m + trend1h; // -2 to +2
        const trendLabel = trendScore >= 1 ? "BULLISH" : trendScore <= -1 ? "BEARISH" : "NEUTRAL";

        const mtfScore = hourly
          ? (hourly.fee_active_tvl_ratio >= s.minFeeActiveTvlRatio ? 1 : 0)
            + (hourly.volume >= s.minVolume ? 1 : 0)
            + (priceChange1h > -10 ? 1 : 0)
            + (trendScore > 0 ? 1 : 0) // bonus for positive momentum
          : 0;

        return {
          ...pool,
          mtf_score: mtfScore,
          mtf_validated: mtfScore >= 2,
          price_change_5m: Math.round(priceChange5m * 100) / 100,
          price_change_1h: Math.round(priceChange1h * 100) / 100,
          trend_label: trendLabel,
          trend_score: trendScore,
        };
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

// The Meteora pool discovery API changed its schema: base/quote token data
// now lives under `token_x` / `token_y`, bin step under `dlmm_params.bin_step`,
// and several top-level fields were renamed (`pool_name` → `name`,
// `base_fee_percentage` → `fee_pct`, `fees` → `fee`, etc.). This function
// normalizes the upstream shape into the compact form the rest of the
// screening code (and the LLM prompt) expects.
function condensePool(p: any) {
  const tx = p.token_x ?? {};
  const ty = p.token_y ?? {};

  const baseSymbol = tx.symbol ?? null;
  const baseMint   = tx.address ?? null;
  const mcap       = typeof tx.market_cap === "number" ? tx.market_cap : null;
  const organic    = typeof tx.organic_score === "number" ? tx.organic_score : null;
  const holders    = typeof tx.holders === "number"
    ? tx.holders
    : typeof p.base_token_holders === "number" ? p.base_token_holders : null;

  return {
    pool: p.pool_address,
    name: p.name || `${baseSymbol}-${ty.symbol}`,
    base: { symbol: baseSymbol, mint: baseMint, mcap: mcap ?? 0 },
    quote: { symbol: ty.symbol ?? null, mint: ty.address ?? null },
    bin_step: p.dlmm_params?.bin_step ?? null,
    fee_pct: p.fee_pct ?? p.dynamic_fee_pct ?? null,
    active_tvl: Math.round(p.active_tvl || p.tvl || 0),
    fee_window: Math.round((p.fee || p.fees || 0) * 100) / 100,
    volume_window: Math.round(p.volume || 0),
    fee_active_tvl_ratio: p.fee_active_tvl_ratio ?? null,
    fee_tvl_ratio: p.fee_tvl_ratio ?? null,
    volatility: p.volatility ?? null,
    organic_score: organic,
    mcap: mcap != null ? Math.round(mcap) : null,
    holders,
    active_positions: p.active_positions ?? null,
    price_change_pct: p.pool_price_change_pct ?? p.price_change_percentage ?? null,
    volume: Math.round(p.volume || 0),
    dev: p.deployer || tx.deployer || null,
  };
}
