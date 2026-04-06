// Hive Mind — opt-in collective intelligence (simplified port)
// Full implementation kept minimal; expand as needed.

import { log } from "./logger";

const SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
let _lastSyncTime = 0;

export function isEnabled(): boolean {
  return Boolean(process.env.HIVE_MIND_URL && process.env.HIVE_MIND_API_KEY);
}

export async function queryPatternConsensus(volatility?: number): Promise<any[] | null> {
  if (!isEnabled()) return null;
  try {
    const qs = volatility != null ? `?volatility=${volatility}` : "";
    const res = await fetch(`${process.env.HIVE_MIND_URL}/api/consensus/patterns${qs}`, {
      headers: { Authorization: `Bearer ${process.env.HIVE_MIND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function formatPoolConsensusForPrompt(poolAddresses: string[]): Promise<string> {
  if (!isEnabled() || poolAddresses.length === 0) return "";
  try {
    const results = await Promise.all(poolAddresses.map(async (addr) => {
      try {
        const res = await fetch(`${process.env.HIVE_MIND_URL}/api/consensus/pool/${encodeURIComponent(addr)}`, {
          headers: { Authorization: `Bearer ${process.env.HIVE_MIND_API_KEY}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    }));

    const lines: string[] = [];
    for (const data of results) {
      if (data && data.unique_agents >= 3) {
        const name = data.pool_name || "unknown";
        lines.push(`[HIVE] ${name}: ${data.unique_agents} agents, ${data.weighted_win_rate ?? 0}% win`);
      }
    }
    if (lines.length === 0) return "";
    return `HIVE MIND CONSENSUS:\n${lines.join("\n")}`;
  } catch { return ""; }
}

export async function syncToHive(): Promise<void> {
  if (!isEnabled() || Date.now() - _lastSyncTime < SYNC_DEBOUNCE_MS) return;
  _lastSyncTime = Date.now();
  // Simplified: full sync implementation can be added later
  log("hive", "Sync skipped (simplified port)");
}
