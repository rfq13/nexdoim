const LPAGENT_API = "https://api.lpagent.io/open-api/v1";
const LPAGENT_KEYS = (process.env.LPAGENT_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
let _keyIndex = 0;
function nextKey() {
  if (!LPAGENT_KEYS.length) return null;
  const key = LPAGENT_KEYS[_keyIndex % LPAGENT_KEYS.length];
  _keyIndex++;
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function studyTopLPers({ pool_address, limit = 4 }: { pool_address: string; limit?: number }) {
  if (!LPAGENT_KEYS.length) {
    return { pool: pool_address, message: "LPAGENT_API_KEY not set — study disabled.", patterns: [], lpers: [] };
  }

  const topRes = await fetch(`${LPAGENT_API}/pools/${pool_address}/top-lpers?sort_order=desc&page=1&limit=20`, {
    headers: { "x-api-key": nextKey()! },
  });
  if (!topRes.ok) {
    if (topRes.status === 429) throw new Error("Rate limit exceeded. Wait 60 seconds.");
    throw new Error(`top-lpers API error: ${topRes.status}`);
  }

  const topData = await topRes.json();
  const all = topData.data || [];
  const credible = all.filter((l: any) => l.total_lp >= 3 && l.win_rate >= 0.6 && l.total_inflow > 1000);
  const top = credible.sort((a: any, b: any) => b.roi - a.roi).slice(0, limit);

  if (top.length === 0) {
    return { pool: pool_address, message: "No credible LPers found.", patterns: [], historical_samples: [] };
  }

  const historicalSamples = [];
  for (const lper of top) {
    try {
      await sleep(1000);
      const histRes = await fetch(`${LPAGENT_API}/lp-positions/historical?owner=${lper.owner}&page=1&limit=50`, {
        headers: { "x-api-key": nextKey()! },
      });
      if (!histRes.ok) continue;
      const histData = await histRes.json();
      historicalSamples.push({
        owner: lper.owner.slice(0, 8) + "...",
        summary: {
          total_positions: lper.total_lp,
          win_rate: Math.round(lper.win_rate * 100) + "%",
          avg_hold_hours: Number(lper.avg_age_hour?.toFixed(2)),
          roi: (lper.roi * 100).toFixed(2) + "%",
          fee_pct_of_capital: (lper.fee_percent * 100).toFixed(2) + "%",
          total_pnl_usd: Math.round(lper.total_pnl),
        },
        positions: (histData.data || []).map((p: any) => ({
          pool: p.pool, pair: p.pairName || `${p.tokenName0}-${p.tokenName1}`,
          hold_hours: p.ageHour != null ? Number(p.ageHour?.toFixed(2)) : null,
          pnl_usd: Math.round(p.pnl?.value || 0),
          pnl_pct: ((p.pnl?.percent || 0) * 100).toFixed(1) + "%",
          fee_usd: Math.round(p.collectedFee || 0),
          in_range_pct: p.inRangePct != null ? Math.round(p.inRangePct * 100) + "%" : null,
          strategy: p.strategy || null, closed_reason: p.closeReason || null,
        })),
      });
    } catch { /* skip failed */ }
  }

  const isNum = (n: unknown): n is number => typeof n === "number" && isFinite(n);
  const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 100) / 100 : null;

  return {
    pool: pool_address,
    patterns: {
      top_lper_count: top.length,
      avg_hold_hours: avg(top.map((l: any) => l.avg_age_hour).filter(isNum)),
      avg_win_rate: avg(top.map((l: any) => l.win_rate).filter(isNum)),
      avg_roi_pct: avg(top.map((l: any) => l.roi * 100).filter(isNum)),
      avg_fee_pct_of_capital: avg(top.map((l: any) => l.fee_percent * 100).filter(isNum)),
      best_roi: (Math.max(...top.map((l: any) => l.roi)) * 100).toFixed(2) + "%",
      scalper_count: top.filter((l: any) => l.avg_age_hour < 1).length,
      holder_count: top.filter((l: any) => l.avg_age_hour >= 4).length,
    },
    lpers: historicalSamples,
  };
}
