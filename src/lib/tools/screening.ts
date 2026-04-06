import { config } from "../config";
import { isBlacklisted } from "../token-blacklist";
import { log } from "../logger";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";

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

  const condensed = (data.data || []).map(condensePool);
  const pools = [];
  for (const p of condensed) {
    if (await isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} in pool ${p.name}`);
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

  const eligible = pools
    .filter((p: any) => !occupiedPools.has(p.pool) && !occupiedMints.has(p.base?.mint))
    .slice(0, limit);

  return { candidates: eligible, total_screened: pools.length };
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
  };
}
