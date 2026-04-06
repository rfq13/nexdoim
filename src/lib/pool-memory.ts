import { prisma } from "./db";
import { log } from "./logger";

export async function recordPoolDeploy(poolAddress: string, deployData: {
  pool_name?: string;
  base_mint?: string;
  deployed_at?: string;
  closed_at?: string;
  pnl_pct?: number;
  pnl_usd?: number;
  range_efficiency?: number;
  minutes_held?: number;
  close_reason?: string;
  strategy?: string;
  volatility?: number;
}) {
  if (!poolAddress) return;

  const existing = await prisma.poolMemory.findUnique({ where: { poolAddress } });

  const deploy = {
    deployed_at: deployData.deployed_at ?? null,
    closed_at: deployData.closed_at ?? new Date().toISOString(),
    pnl_pct: deployData.pnl_pct ?? null,
    pnl_usd: deployData.pnl_usd ?? null,
    range_efficiency: deployData.range_efficiency ?? null,
    minutes_held: deployData.minutes_held ?? null,
    close_reason: deployData.close_reason ?? null,
    strategy: deployData.strategy ?? null,
    volatility_at_deploy: deployData.volatility ?? null,
  };

  if (!existing) {
    await prisma.poolMemory.create({
      data: {
        poolAddress,
        name: deployData.pool_name ?? poolAddress.slice(0, 8),
        baseMint: deployData.base_mint ?? null,
        deploys: [deploy],
        totalDeploys: 1,
        avgPnlPct: deploy.pnl_pct ?? 0,
        winRate: (deploy.pnl_pct ?? 0) >= 0 ? 1 : 0,
        lastDeployedAt: new Date(),
        lastOutcome: (deploy.pnl_pct ?? 0) >= 0 ? "profit" : "loss",
      },
    });
  } else {
    const deploys = [...(existing.deploys as unknown[]), deploy];
    const withPnl = deploys.filter((d: any) => d.pnl_pct != null) as Array<{ pnl_pct: number }>;
    const avgPnl = withPnl.length > 0
      ? Math.round((withPnl.reduce((s, d) => s + d.pnl_pct, 0) / withPnl.length) * 100) / 100
      : 0;
    const winRate = withPnl.length > 0
      ? Math.round((withPnl.filter((d) => d.pnl_pct >= 0).length / withPnl.length) * 100) / 100
      : 0;

    await prisma.poolMemory.update({
      where: { poolAddress },
      data: {
        deploys: deploys as object[],
        totalDeploys: deploys.length,
        avgPnlPct: avgPnl,
        winRate,
        lastDeployedAt: new Date(),
        lastOutcome: (deploy.pnl_pct ?? 0) >= 0 ? "profit" : "loss",
        baseMint: deployData.base_mint ?? existing.baseMint,
      },
    });
  }
  log("pool-memory", `Recorded deploy for ${deployData.pool_name ?? poolAddress.slice(0, 8)}: PnL ${deploy.pnl_pct}%`);
}

export async function getPoolMemory({ pool_address }: { pool_address: string }) {
  if (!pool_address) return { error: "pool_address required" };

  const entry = await prisma.poolMemory.findUnique({ where: { poolAddress: pool_address } });
  if (!entry) {
    return { pool_address, known: false, message: "No history for this pool — first time deploying here." };
  }

  const deploys = entry.deploys as unknown[];
  return {
    pool_address,
    known: true,
    name: entry.name,
    base_mint: entry.baseMint,
    total_deploys: entry.totalDeploys,
    avg_pnl_pct: entry.avgPnlPct,
    win_rate: entry.winRate,
    last_deployed_at: entry.lastDeployedAt?.toISOString(),
    last_outcome: entry.lastOutcome,
    notes: entry.notes,
    history: deploys.slice(-10),
  };
}

export async function recordPositionSnapshot(poolAddress: string, snapshot: Record<string, unknown>) {
  if (!poolAddress) return;

  const entry = await prisma.poolMemory.findUnique({ where: { poolAddress } });

  const snap = {
    ts: new Date().toISOString(),
    position: snapshot.position,
    pnl_pct: snapshot.pnl_pct ?? null,
    pnl_usd: snapshot.pnl_usd ?? null,
    in_range: snapshot.in_range ?? null,
    unclaimed_fees_usd: snapshot.unclaimed_fees_usd ?? null,
    minutes_out_of_range: snapshot.minutes_out_of_range ?? null,
    age_minutes: snapshot.age_minutes ?? null,
  };

  if (!entry) {
    await prisma.poolMemory.create({
      data: {
        poolAddress,
        name: (snapshot.pair as string) ?? poolAddress.slice(0, 8),
        snapshots: [snap],
      },
    });
  } else {
    const snapshots = [...(entry.snapshots as unknown[]), snap].slice(-48);
    await prisma.poolMemory.update({
      where: { poolAddress },
      data: { snapshots: snapshots as object[] },
    });
  }
}

export async function recallForPool(poolAddress: string): Promise<string | null> {
  if (!poolAddress) return null;
  const entry = await prisma.poolMemory.findUnique({ where: { poolAddress } });
  if (!entry) return null;

  const lines: string[] = [];

  if (entry.totalDeploys > 0) {
    lines.push(`POOL MEMORY [${entry.name}]: ${entry.totalDeploys} past deploy(s), avg PnL ${entry.avgPnlPct}%, win rate ${entry.winRate}%, last outcome: ${entry.lastOutcome}`);
  }

  const snaps = ((entry.snapshots as unknown[]) ?? []).slice(-6) as Array<{ pnl_pct?: number; in_range?: boolean }>;
  if (snaps.length >= 2) {
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const pnlTrend = last.pnl_pct != null && first.pnl_pct != null
      ? (last.pnl_pct - first.pnl_pct).toFixed(2)
      : null;
    const oorCount = snaps.filter((s) => s.in_range === false).length;
    lines.push(`RECENT TREND: PnL drift ${pnlTrend !== null ? (Number(pnlTrend) >= 0 ? "+" : "") + pnlTrend + "%" : "unknown"} over last ${snaps.length} cycles, OOR in ${oorCount}/${snaps.length} cycles`);
  }

  const notes = (entry.notes as Array<{ note: string }>) ?? [];
  if (notes.length > 0) {
    lines.push(`NOTE: ${notes[notes.length - 1].note}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export async function addPoolNote({ pool_address, note }: { pool_address: string; note: string }) {
  if (!pool_address) return { error: "pool_address required" };
  if (!note) return { error: "note required" };

  const entry = await prisma.poolMemory.findUnique({ where: { poolAddress: pool_address } });
  const noteEntry = { note, added_at: new Date().toISOString() };

  if (!entry) {
    await prisma.poolMemory.create({
      data: {
        poolAddress: pool_address,
        name: pool_address.slice(0, 8),
        notes: [noteEntry],
      },
    });
  } else {
    const notes = [...(entry.notes as unknown[]), noteEntry];
    await prisma.poolMemory.update({
      where: { poolAddress: pool_address },
      data: { notes: notes as object[] },
    });
  }
  log("pool-memory", `Note added to ${pool_address.slice(0, 8)}: ${note}`);
  return { saved: true, pool_address, note };
}
