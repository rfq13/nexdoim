import { prisma } from "./db";
import { log } from "./logger";

const MAX_RECENT_EVENTS = 20;

export async function trackPosition(data: {
  position: string;
  pool: string;
  pool_name?: string;
  strategy?: string;
  bin_range?: Record<string, unknown>;
  amount_sol?: number;
  amount_x?: number;
  active_bin?: number;
  bin_step?: number;
  volatility?: number;
  fee_tvl_ratio?: number;
  organic_score?: number;
  initial_value_usd?: number;
}) {
  await prisma.position.create({
    data: {
      id: data.position,
      pool: data.pool,
      poolName: data.pool_name ?? null,
      strategy: data.strategy ?? null,
      binRange: data.bin_range ?? null,
      amountSol: data.amount_sol ?? null,
      amountX: data.amount_x ?? null,
      activeBinAtDeploy: data.active_bin ?? null,
      binStep: data.bin_step ?? null,
      volatility: data.volatility ?? null,
      feeTvlRatio: data.fee_tvl_ratio ?? null,
      initialFeeTvl24h: data.fee_tvl_ratio ?? null,
      organicScore: data.organic_score ?? null,
      initialValueUsd: data.initial_value_usd ?? null,
      notes: [],
    },
  });
  await pushEvent({ action: "deploy", position: data.position, poolName: data.pool_name ?? data.pool });
  log("state", `Tracked new position: ${data.position} in pool ${data.pool}`);
}

export async function markOutOfRange(positionAddress: string) {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos || pos.outOfRangeSince) return;
  await prisma.position.update({
    where: { id: positionAddress },
    data: { outOfRangeSince: new Date() },
  });
  log("state", `Position ${positionAddress} marked out of range`);
}

export async function markInRange(positionAddress: string) {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos || !pos.outOfRangeSince) return;
  await prisma.position.update({
    where: { id: positionAddress },
    data: { outOfRangeSince: null },
  });
  log("state", `Position ${positionAddress} back in range`);
}

export async function minutesOutOfRange(positionAddress: string): Promise<number> {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos?.outOfRangeSince) return 0;
  return Math.floor((Date.now() - new Date(pos.outOfRangeSince).getTime()) / 60000);
}

export async function recordClaim(positionAddress: string, feesUsd: number) {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos) return;
  const notes = (pos.notes as string[]) ?? [];
  notes.push(`Claimed ~$${feesUsd?.toFixed(2) ?? "?"} fees at ${new Date().toISOString()}`);
  await prisma.position.update({
    where: { id: positionAddress },
    data: {
      lastClaimAt: new Date(),
      totalFeesClaimed: (pos.totalFeesClaimed ?? 0) + (feesUsd ?? 0),
      notes,
    },
  });
}

export async function recordClose(positionAddress: string, reason: string) {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos) return;
  const notes = (pos.notes as string[]) ?? [];
  const now = new Date();
  notes.push(`Closed at ${now.toISOString()}: ${reason}`);
  await prisma.position.update({
    where: { id: positionAddress },
    data: { closed: true, closedAt: now, notes },
  });
  await pushEvent({ action: "close", position: positionAddress, poolName: pos.poolName ?? pos.pool, reason });
  log("state", `Position ${positionAddress} marked closed: ${reason}`);
}

export async function recordRebalance(oldPosition: string, newPosition: string) {
  const now = new Date();
  const old = await prisma.position.findUnique({ where: { id: oldPosition } });
  if (old) {
    const notes = (old.notes as string[]) ?? [];
    notes.push(`Rebalanced into ${newPosition} at ${now.toISOString()}`);
    await prisma.position.update({
      where: { id: oldPosition },
      data: { closed: true, closedAt: now, notes },
    });
  }
  const newPos = await prisma.position.findUnique({ where: { id: newPosition } });
  if (newPos) {
    const notes = (newPos.notes as string[]) ?? [];
    notes.push(`Rebalanced from ${oldPosition}`);
    await prisma.position.update({
      where: { id: newPosition },
      data: { rebalanceCount: (old?.rebalanceCount ?? 0) + 1, notes },
    });
  }
}

export async function setPositionInstruction(positionAddress: string, instruction: string | null): Promise<boolean> {
  const pos = await prisma.position.findUnique({ where: { id: positionAddress } });
  if (!pos) return false;
  await prisma.position.update({
    where: { id: positionAddress },
    data: { instruction: instruction ?? null },
  });
  log("state", `Position ${positionAddress} instruction set: ${instruction}`);
  return true;
}

export async function getTrackedPositions(openOnly = false) {
  const where = openOnly ? { closed: false } : {};
  return prisma.position.findMany({ where, orderBy: { deployedAt: "desc" } });
}

export async function getTrackedPosition(positionAddress: string) {
  return prisma.position.findUnique({ where: { id: positionAddress } });
}

export async function getStateSummary() {
  const open = await prisma.position.findMany({ where: { closed: false } });
  const closedCount = await prisma.position.count({ where: { closed: true } });
  const totalFees = await prisma.position.aggregate({ _sum: { totalFeesClaimed: true } });
  const events = await prisma.recentEvent.findMany({ orderBy: { ts: "desc" }, take: 10 });

  return {
    open_positions: open.length,
    closed_positions: closedCount,
    total_fees_claimed_usd: Math.round((totalFees._sum.totalFeesClaimed ?? 0) * 100) / 100,
    positions: await Promise.all(open.map(async (p) => ({
      position: p.id,
      pool: p.pool,
      strategy: p.strategy,
      deployed_at: p.deployedAt.toISOString(),
      out_of_range_since: p.outOfRangeSince?.toISOString() ?? null,
      minutes_out_of_range: await minutesOutOfRange(p.id),
      total_fees_claimed_usd: p.totalFeesClaimed,
      initial_fee_tvl_24h: p.initialFeeTvl24h,
      rebalance_count: p.rebalanceCount,
      instruction: p.instruction ?? null,
    }))),
    last_updated: new Date().toISOString(),
    recent_events: events.map((e) => ({
      ts: e.ts.toISOString(),
      action: e.action,
      position: e.position,
      pool_name: e.poolName,
      reason: e.reason,
    })),
  };
}

export async function getLastBriefingDate(): Promise<string | null> {
  const row = await prisma.appState.findUnique({ where: { key: "lastBriefingDate" } });
  return row?.value ?? null;
}

export async function setLastBriefingDate() {
  const val = new Date().toISOString().slice(0, 10);
  await prisma.appState.upsert({
    where: { key: "lastBriefingDate" },
    update: { value: val },
    create: { key: "lastBriefingDate", value: val },
  });
}

export async function syncOpenPositions(activeAddresses: string[]) {
  const GRACE_MS = 5 * 60_000;
  const activeSet = new Set(activeAddresses);
  const open = await prisma.position.findMany({ where: { closed: false } });

  for (const pos of open) {
    if (activeSet.has(pos.id)) continue;
    const deployedAt = pos.deployedAt.getTime();
    if (Date.now() - deployedAt < GRACE_MS) continue;

    const notes = (pos.notes as string[]) ?? [];
    notes.push("Auto-closed during state sync (not found on-chain)");
    await prisma.position.update({
      where: { id: pos.id },
      data: { closed: true, closedAt: new Date(), notes },
    });
    log("state", `Position ${pos.id} auto-closed (missing from on-chain data)`);
  }
}

async function pushEvent(event: { action: string; position?: string; poolName?: string; reason?: string }) {
  await prisma.recentEvent.create({
    data: {
      action: event.action,
      position: event.position ?? null,
      poolName: event.poolName ?? null,
      reason: event.reason ?? null,
    },
  });
  // Trim old events
  const count = await prisma.recentEvent.count();
  if (count > MAX_RECENT_EVENTS) {
    const old = await prisma.recentEvent.findMany({
      orderBy: { ts: "asc" },
      take: count - MAX_RECENT_EVENTS,
      select: { id: true },
    });
    await prisma.recentEvent.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
  }
}
