const DATAPI_BASE = "https://datapi.jup.ag/v1";

export async function getTokenNarrative({ mint }: { mint: string }) {
  const res = await fetch(`${DATAPI_BASE}/chaininsight/narrative/${mint}`);
  if (!res.ok) throw new Error(`Narrative API error: ${res.status}`);
  const data = await res.json();
  return { mint, narrative: data.narrative || null, status: data.status };
}

export async function getTokenInfo({ query }: { query: string }) {
  const url = `${DATAPI_BASE}/assets/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Token search API error: ${res.status}`);
  const data = await res.json();
  const tokens = Array.isArray(data) ? data : [data];
  if (!tokens.length) return { found: false, query };

  return {
    found: true, query,
    results: tokens.slice(0, 5).map((t: any) => ({
      mint: t.id, name: t.name, symbol: t.symbol, mcap: t.mcap, price: t.usdPrice,
      liquidity: t.liquidity, holders: t.holderCount, organic_score: t.organicScore,
      organic_label: t.organicScoreLabel, launchpad: t.launchpad, graduated: !!t.graduatedPool,
      global_fees_sol: t.fees != null ? parseFloat(t.fees.toFixed(2)) : null,
      audit: t.audit ? {
        mint_disabled: t.audit.mintAuthorityDisabled, freeze_disabled: t.audit.freezeAuthorityDisabled,
        top_holders_pct: t.audit.topHoldersPercentage?.toFixed(2), bot_holders_pct: t.audit.botHoldersPercentage?.toFixed(2),
        dev_migrations: t.audit.devMigrations,
      } : null,
      stats_1h: t.stats1h ? {
        price_change: t.stats1h.priceChange?.toFixed(2), buy_vol: t.stats1h.buyVolume?.toFixed(0),
        sell_vol: t.stats1h.sellVolume?.toFixed(0), buyers: t.stats1h.numOrganicBuyers, net_buyers: t.stats1h.numNetBuyers,
      } : null,
      stats_24h: t.stats24h ? {
        price_change: t.stats24h.priceChange?.toFixed(2), buy_vol: t.stats24h.buyVolume?.toFixed(0),
        sell_vol: t.stats24h.sellVolume?.toFixed(0), buyers: t.stats24h.numOrganicBuyers, net_buyers: t.stats24h.numNetBuyers,
      } : null,
    })),
  };
}

export async function getTokenHolders({ mint, limit = 20 }: { mint: string; limit?: number }) {
  const [holdersRes, tokenRes] = await Promise.all([
    fetch(`${DATAPI_BASE}/holders/${mint}?limit=100`),
    fetch(`${DATAPI_BASE}/assets/search?query=${mint}`),
  ]);
  if (!holdersRes.ok) throw new Error(`Holders API error: ${holdersRes.status}`);
  const data = await holdersRes.json();
  const tokenData = tokenRes.ok ? await tokenRes.json() : null;
  const tokenInfo = Array.isArray(tokenData) ? tokenData[0] : tokenData;
  const totalSupply = tokenInfo?.totalSupply || tokenInfo?.circSupply || null;

  const holders = Array.isArray(data) ? data : (data.holders || data.data || []);

  const mapped = holders.slice(0, Math.min(limit, 100)).map((h: any) => {
    const tags = (h.tags || []).map((t: any) => t.name || t.id || t);
    const isPool = tags.some((t: string) => /pool|amm|liquidity|raydium|orca|meteora/i.test(t));
    const pct = totalSupply ? (Number(h.amount) / totalSupply) * 100 : (h.percentage ?? h.pct ?? null);
    return {
      address: h.address || h.wallet, amount: h.amount,
      pct: pct != null ? parseFloat(pct.toFixed(4)) : null,
      sol_balance: h.solBalanceDisplay ?? h.solBalance,
      tags: tags.length ? tags : undefined, is_pool: isPool,
      funder: h.funder ? { address: h.funder.address, amount_sol: h.funder.amount, slot: h.funder.slot } : undefined,
    };
  });

  // Bundler detection
  const realHolders = mapped.filter((h: any) => !h.is_pool);
  const top10Real = realHolders.slice(0, 10);
  const top10Pct = top10Real.reduce((sum: number, h: any) => sum + (h.pct ?? 0), 0);

  const funderMap = new Map<string, number>();
  for (const h of realHolders) {
    if (h.funder?.address) {
      funderMap.set(h.funder.address, (funderMap.get(h.funder.address) || 0) + 1);
    }
  }
  const commonFunders = [...funderMap.entries()].filter(([, count]) => count >= 3);
  const bundlerCount = commonFunders.reduce((sum, [, count]) => sum + count, 0);
  const bundlersPct = realHolders.length > 0 ? Math.round((bundlerCount / realHolders.length) * 100) : 0;

  return {
    mint, total_holders_checked: mapped.length, holders: mapped,
    top_10_real_holders_pct: Math.round(top10Pct * 100) / 100,
    bundlers_pct_in_top_100: bundlersPct,
    common_funders: commonFunders.map(([addr, count]) => ({ funder: addr, funded_count: count })),
    global_fees_sol: tokenInfo?.fees != null ? parseFloat(tokenInfo.fees.toFixed(2)) : null,
  };
}
