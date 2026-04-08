import { prisma } from "./db";
import { log } from "./logger";
import { config, saveConfig } from "./config";

const MIN_EVOLVE_POSITIONS = 5;
const MAX_CHANGE_PER_STEP = 0.20;

// ─── Record Position Performance ──────────────────────────────

export async function recordPerformance(perf: {
  position: string;
  pool: string;
  pool_name?: string;
  base_mint?: string;
  strategy?: string;
  bin_range?: number;
  bin_step?: number;
  volatility?: number;
  fee_tvl_ratio?: number;
  organic_score?: number;
  amount_sol?: number;
  fees_earned_usd: number;
  final_value_usd: number;
  initial_value_usd: number;
  minutes_in_range?: number;
  minutes_held?: number;
  close_reason?: string;
  deployed_at?: string;
}) {
  const pnl_usd = (perf.final_value_usd + perf.fees_earned_usd) - perf.initial_value_usd;
  const pnl_pct = perf.initial_value_usd > 0 ? (pnl_usd / perf.initial_value_usd) * 100 : 0;
  const range_efficiency = (perf.minutes_held ?? 0) > 0
    ? ((perf.minutes_in_range ?? 0) / perf.minutes_held!) * 100
    : 0;

  // IL = fees_earned - total_pnl (if fees > pnl, the difference is IL eaten by fees)
  // IL is the value lost due to price movement: initial_value - final_value (excluding fees)
  const value_change = perf.final_value_usd - perf.initial_value_usd;
  const il_usd = value_change < 0 ? Math.abs(value_change) : 0;
  const fee_to_il_ratio = il_usd > 0 ? perf.fees_earned_usd / il_usd : perf.fees_earned_usd > 0 ? Infinity : 0;

  await prisma.performance.create({
    data: {
      position: perf.position,
      pool: perf.pool,
      poolName: perf.pool_name ?? null,
      baseMint: perf.base_mint ?? null,
      strategy: perf.strategy ?? null,
      binRange: perf.bin_range ?? null,
      binStep: perf.bin_step ?? null,
      volatility: perf.volatility ?? null,
      feeTvlRatio: perf.fee_tvl_ratio ?? null,
      organicScore: perf.organic_score ?? null,
      amountSol: perf.amount_sol ?? null,
      feesEarnedUsd: perf.fees_earned_usd,
      finalValueUsd: perf.final_value_usd,
      initialValueUsd: perf.initial_value_usd,
      minutesInRange: perf.minutes_in_range ?? null,
      minutesHeld: perf.minutes_held ?? null,
      closeReason: perf.close_reason ?? null,
      pnlUsd: Math.round(pnl_usd * 100) / 100,
      pnlPct: Math.round(pnl_pct * 100) / 100,
      ilUsd: Math.round(il_usd * 100) / 100,
      feeToIlRatio: fee_to_il_ratio === Infinity ? 999 : Math.round(fee_to_il_ratio * 100) / 100,
      rangeEfficiency: Math.round(range_efficiency * 10) / 10,
      deployedAt: perf.deployed_at ? new Date(perf.deployed_at) : null,
    },
  });

  // Derive lesson
  const lesson = derivLesson({
    pool_name: perf.pool_name,
    strategy: perf.strategy,
    volatility: perf.volatility,
    bin_range: perf.bin_range,
    pnl_pct: Math.round(pnl_pct * 100) / 100,
    range_efficiency: Math.round(range_efficiency * 10) / 10,
    close_reason: perf.close_reason,
    il_usd: Math.round(il_usd * 100) / 100,
    fees_earned_usd: Math.round(perf.fees_earned_usd * 100) / 100,
    fee_to_il_ratio: fee_to_il_ratio === Infinity ? 999 : Math.round(fee_to_il_ratio * 100) / 100,
  });
  if (lesson) {
    await prisma.lesson.create({ data: lesson });
    log("lessons", `New lesson: ${lesson.rule}`);
  }

  // Pool memory update
  const { recordPoolDeploy } = await import("./pool-memory");
  await recordPoolDeploy(perf.pool, {
    pool_name: perf.pool_name,
    base_mint: perf.base_mint,
    deployed_at: perf.deployed_at,
    closed_at: new Date().toISOString(),
    pnl_pct: Math.round(pnl_pct * 100) / 100,
    pnl_usd: Math.round(pnl_usd * 100) / 100,
    range_efficiency: Math.round(range_efficiency * 10) / 10,
    minutes_held: perf.minutes_held,
    close_reason: perf.close_reason,
    strategy: perf.strategy,
    volatility: perf.volatility,
  });

  // Evolve thresholds every 5 positions
  const count = await prisma.performance.count();
  if (count % 5 === 0 && count >= MIN_EVOLVE_POSITIONS) {
    await evolveThresholds();
  }
}

function derivLesson(entry: {
  pool_name?: string;
  strategy?: string;
  volatility?: number;
  bin_range?: number;
  pnl_pct: number;
  range_efficiency: number;
  close_reason?: string;
  il_usd?: number;
  fees_earned_usd?: number;
  fee_to_il_ratio?: number;
}) {
  const pnl = entry.pnl_pct;
  let outcome: string;
  if (pnl >= 5) outcome = "good";
  else if (pnl >= 0) outcome = "neutral";
  else if (pnl >= -5) outcome = "poor";
  else outcome = "bad";

  if (outcome === "neutral") return null;

  const pool = entry.pool_name ?? "unknown";
  const strategy = entry.strategy ?? "unknown";
  const vol = entry.volatility ?? 0;
  const eff = entry.range_efficiency;
  const il = entry.il_usd ?? 0;
  const fees = entry.fees_earned_usd ?? 0;
  const feeIlRatio = entry.fee_to_il_ratio ?? 0;

  let rule: string;
  const tags: string[] = [outcome];

  if (outcome === "good") {
    rule = `WORKED: ${pool} ${strategy} → +${pnl.toFixed(1)}%, ${eff}% in-range`;
    if (il > 0) rule += `, fees $${fees} > IL $${il} (ratio ${feeIlRatio}x)`;
    tags.push("worked", "screening");
  } else if (outcome === "bad") {
    rule = `AVOID: ${pool} (vol=${vol}, ${strategy}) → ${pnl.toFixed(1)}%, ${eff}% in-range`;
    if (il > 0) rule += `, IL $${il} destroyed fees $${fees} (ratio ${feeIlRatio}x)`;
    if (entry.close_reason) rule += `. Reason: ${entry.close_reason}`;
    tags.push("failed", "screening", "il_loss");
  } else {
    rule = `FAILED: ${pool} ${strategy} → ${pnl.toFixed(1)}%, ${eff}% in-range`;
    if (il > 0) rule += `, IL $${il} vs fees $${fees}`;
    if (entry.close_reason) rule += `. Reason: ${entry.close_reason}`;
    tags.push("failed");
  }

  return { rule, tags, outcome, pinned: false, role: null as string | null };
}

// ─── Lessons CRUD ─────────────────────────────────────────────

export async function addLesson(rule: string, tags: string[] = [], opts?: { pinned?: boolean; role?: string | null }) {
  await prisma.lesson.create({
    data: {
      rule,
      tags,
      pinned: opts?.pinned ?? false,
      role: opts?.role ?? null,
    },
  });
}

export async function pinLesson(id: number) {
  await prisma.lesson.update({ where: { id }, data: { pinned: true } });
  return { pinned: true, id };
}

export async function unpinLesson(id: number) {
  await prisma.lesson.update({ where: { id }, data: { pinned: false } });
  return { unpinned: true, id };
}

export async function listLessons(opts?: { role?: string; pinned?: boolean; tag?: string; limit?: number }) {
  const where: Record<string, unknown> = {};
  if (opts?.pinned !== undefined) where.pinned = opts.pinned;
  if (opts?.role) where.role = opts.role;
  if (opts?.tag) where.tags = { has: opts.tag };

  const lessons = await prisma.lesson.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });
  return { total: lessons.length, lessons };
}

export async function clearAllLessons(): Promise<number> {
  const result = await prisma.lesson.deleteMany();
  return result.count;
}

export async function clearPerformance(): Promise<number> {
  const result = await prisma.performance.deleteMany();
  return result.count;
}

export async function removeLessonsByKeyword(keyword: string): Promise<number> {
  const all = await prisma.lesson.findMany();
  const toDelete = all.filter((l) => l.rule.toLowerCase().includes(keyword.toLowerCase()));
  if (toDelete.length > 0) {
    await prisma.lesson.deleteMany({ where: { id: { in: toDelete.map((l) => l.id) } } });
  }
  return toDelete.length;
}

// ─── Get Lessons for Prompt ───────────────────────────────────

const SCREENER_TAGS = ["screening", "narrative", "strategy", "deployment", "token", "volume", "entry", "bundler", "holders", "organic"];
const MANAGER_TAGS = ["management", "risk", "oor", "fees", "position", "hold", "close", "pnl", "rebalance", "claim"];

export async function getLessonsForPrompt(opts: { agentType?: string; maxLessons?: number } = {}): Promise<string> {
  const maxLessons = opts.maxLessons ?? 20;
  const agentType = opts.agentType ?? "GENERAL";

  const pinned = await prisma.lesson.findMany({ where: { pinned: true }, take: 5, orderBy: { createdAt: "desc" } });

  const roleTags = agentType === "SCREENER" ? SCREENER_TAGS : agentType === "MANAGER" ? MANAGER_TAGS : [];
  const roleMatched = roleTags.length > 0
    ? await prisma.lesson.findMany({
        where: { pinned: false, tags: { hasSome: roleTags } },
        take: 6,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const usedIds = new Set([...pinned.map((l) => l.id), ...roleMatched.map((l) => l.id)]);
  const remaining = maxLessons - pinned.length - roleMatched.length;
  const recent = remaining > 0
    ? await prisma.lesson.findMany({
        where: { id: { notIn: Array.from(usedIds) } },
        take: remaining,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const sections: string[] = [];
  if (pinned.length) {
    sections.push(`── PINNED (${pinned.length}) ──`);
    pinned.forEach((l) => sections.push(`📌 [${l.outcome?.toUpperCase() ?? ""}] ${l.rule}`));
  }
  if (roleMatched.length) {
    sections.push(`── ${agentType} (${roleMatched.length}) ──`);
    roleMatched.forEach((l) => sections.push(`[${l.outcome?.toUpperCase() ?? ""}] ${l.rule}`));
  }
  if (recent.length) {
    sections.push(`── RECENT (${recent.length}) ──`);
    recent.forEach((l) => sections.push(`[${l.outcome?.toUpperCase() ?? ""}] ${l.rule}`));
  }

  return sections.join("\n");
}

// ─── Performance Summary ──────────────────────────────────────

export async function getPerformanceSummary() {
  const all = await prisma.performance.findMany();
  if (all.length === 0) return null;

  const totalPnl = all.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);
  const totalFees = all.reduce((s, p) => s + (p.feesEarnedUsd ?? 0), 0);
  const totalIl = all.reduce((s, p) => s + ((p as any).ilUsd ?? 0), 0);
  const winners = all.filter((p) => (p.pnlUsd ?? 0) > 0).length;

  // Recent streak (last 5)
  const recent = all.sort((a, b) => (b.recordedAt?.getTime() ?? 0) - (a.recordedAt?.getTime() ?? 0)).slice(0, 5);
  const recentWins = recent.filter((p) => (p.pnlUsd ?? 0) > 0).length;
  const recentLosses = recent.length - recentWins;

  return {
    total_positions_closed: all.length,
    total_pnl_usd: Math.round(totalPnl * 100) / 100,
    total_fees_usd: Math.round(totalFees * 100) / 100,
    total_il_usd: Math.round(totalIl * 100) / 100,
    avg_fee_to_il_ratio: totalIl > 0 ? Math.round((totalFees / totalIl) * 100) / 100 : null,
    avg_pnl_pct: Math.round((all.reduce((s, p) => s + (p.pnlPct ?? 0), 0) / all.length) * 100) / 100,
    win_rate_pct: Math.round((winners / all.length) * 100),
    recent_streak: { wins: recentWins, losses: recentLosses },
  };
}

export async function getPerformanceHistory(opts?: { hours?: number; limit?: number }) {
  const where: Record<string, unknown> = {};
  if (opts?.hours) {
    where.recordedAt = { gte: new Date(Date.now() - opts.hours * 3600_000) };
  }
  return prisma.performance.findMany({
    where,
    orderBy: { recordedAt: "desc" },
    take: opts?.limit ?? 50,
  });
}

// ─── Threshold Evolution ──────────────────────────────────────

export async function evolveThresholds() {
  const all = await prisma.performance.findMany();
  if (all.length < MIN_EVOLVE_POSITIONS) return null;

  const winners = all.filter((p) => (p.pnlPct ?? 0) > 0);
  const losers = all.filter((p) => (p.pnlPct ?? 0) < -5);

  if (winners.length < 2 && losers.length < 2) return null;

  const changes: Record<string, number> = {};
  const rationale: Record<string, string> = {};
  const s = config.screening;

  // minOrganic
  if (winners.length >= 2 && losers.length >= 2) {
    const avgWinOrganic = avg(winners.map((w) => w.organicScore).filter(isNum) as number[]);
    const avgLoseOrganic = avg(losers.map((l) => l.organicScore).filter(isNum) as number[]);
    if (avgWinOrganic != null && avgLoseOrganic != null && avgWinOrganic > avgLoseOrganic) {
      const newVal = clampChange(s.minOrganic, avgLoseOrganic + (avgWinOrganic - avgLoseOrganic) * 0.3, MAX_CHANGE_PER_STEP);
      if (Math.abs(newVal - s.minOrganic) > 1) {
        changes.minOrganic = Math.round(newVal);
        rationale.minOrganic = `${s.minOrganic} → ${Math.round(newVal)} (winners avg ${avgWinOrganic}, losers avg ${avgLoseOrganic})`;
      }
    }
  }

  if (Object.keys(changes).length === 0) return null;

  // Apply changes
  for (const [key, val] of Object.entries(changes)) {
    (s as Record<string, unknown>)[key] = val;
  }
  await saveConfig({ ...changes, _lastEvolution: new Date().toISOString() });

  // Record evolution as lesson
  const summary = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ");
  await addLesson(`[EVOLVED] Thresholds adjusted: ${summary}`, ["evolution", "self_tune"]);

  log("lessons", `Thresholds evolved: ${JSON.stringify(changes)}`);
  return { changes, rationale };
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && isFinite(n);
}

function clampChange(current: number, target: number, maxPct: number): number {
  const maxDelta = current * maxPct;
  const delta = target - current;
  return current + Math.max(-maxDelta, Math.min(maxDelta, delta));
}
