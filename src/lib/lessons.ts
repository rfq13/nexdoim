import { supabase } from "./db";
import { log } from "./logger";
import { config, saveConfig } from "./config";
import { recalculateWeights } from "./signal-weights";

const MIN_EVOLVE_POSITIONS = 5;
const MAX_CHANGE_PER_STEP = 0.2;

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
  signal_snapshot?: Record<string, any> | null;
}) {
  const pnlUsd =
    perf.final_value_usd + perf.fees_earned_usd - perf.initial_value_usd;
  const pnlPct =
    perf.initial_value_usd > 0 ? (pnlUsd / perf.initial_value_usd) * 100 : 0;
  const rangeEfficiency =
    (perf.minutes_held ?? 0) > 0
      ? ((perf.minutes_in_range ?? 0) / perf.minutes_held!) * 100
      : 0;

  const valueChange = perf.final_value_usd - perf.initial_value_usd;
  const ilUsd = valueChange < 0 ? Math.abs(valueChange) : 0;
  const feeToIlRatio =
    ilUsd > 0
      ? perf.fees_earned_usd / ilUsd
      : perf.fees_earned_usd > 0
        ? Infinity
        : 0;

  // Fetch signal_snapshot from positions table if not provided directly
  let signalSnapshot = perf.signal_snapshot ?? null;
  if (!signalSnapshot && perf.position) {
    const { data: posRow } = await supabase
      .from("positions")
      .select("signal_snapshot")
      .eq("id", perf.position)
      .maybeSingle();
    signalSnapshot = posRow?.signal_snapshot ?? null;
  }

  const { error } = await supabase.from("performance").insert({
    position: perf.position,
    pool: perf.pool,
    pool_name: perf.pool_name ?? null,
    base_mint: perf.base_mint ?? null,
    strategy: perf.strategy ?? null,
    bin_range: perf.bin_range ?? null,
    bin_step: perf.bin_step ?? null,
    volatility: perf.volatility ?? null,
    fee_tvl_ratio: perf.fee_tvl_ratio ?? null,
    organic_score: perf.organic_score ?? null,
    amount_sol: perf.amount_sol ?? null,
    fees_earned_usd: perf.fees_earned_usd,
    final_value_usd: perf.final_value_usd,
    initial_value_usd: perf.initial_value_usd,
    minutes_in_range: perf.minutes_in_range ?? null,
    minutes_held: perf.minutes_held ?? null,
    close_reason: perf.close_reason ?? null,
    pnl_usd: Math.round(pnlUsd * 100) / 100,
    pnl_pct: Math.round(pnlPct * 100) / 100,
    il_usd: Math.round(ilUsd * 100) / 100,
    fee_to_il_ratio:
      feeToIlRatio === Infinity ? 999 : Math.round(feeToIlRatio * 100) / 100,
    range_efficiency: Math.round(rangeEfficiency * 10) / 10,
    deployed_at: perf.deployed_at
      ? new Date(perf.deployed_at).toISOString()
      : null,
    signal_snapshot: signalSnapshot,
  });

  if (error) throw error;

  const lesson = derivLesson({
    pool_name: perf.pool_name,
    strategy: perf.strategy,
    volatility: perf.volatility,
    bin_range: perf.bin_range,
    pnl_pct: Math.round(pnlPct * 100) / 100,
    range_efficiency: Math.round(rangeEfficiency * 10) / 10,
    close_reason: perf.close_reason,
    il_usd: Math.round(ilUsd * 100) / 100,
    fees_earned_usd: Math.round(perf.fees_earned_usd * 100) / 100,
    fee_to_il_ratio:
      feeToIlRatio === Infinity ? 999 : Math.round(feeToIlRatio * 100) / 100,
  });

  if (lesson) {
    const { error: lessonError } = await supabase
      .from("lessons")
      .insert(lesson);
    if (lessonError) throw lessonError;
    log("lessons", `New lesson: ${lesson.rule}`);
  }

  const { recordPoolDeploy } = await import("./pool-memory");
  await recordPoolDeploy(perf.pool, {
    pool_name: perf.pool_name,
    base_mint: perf.base_mint,
    deployed_at: perf.deployed_at,
    closed_at: new Date().toISOString(),
    pnl_pct: Math.round(pnlPct * 100) / 100,
    pnl_usd: Math.round(pnlUsd * 100) / 100,
    range_efficiency: Math.round(rangeEfficiency * 10) / 10,
    minutes_held: perf.minutes_held,
    close_reason: perf.close_reason,
    strategy: perf.strategy,
    volatility: perf.volatility,
  });

  const { count, error: countError } = await supabase
    .from("performance")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if ((count ?? 0) % 5 === 0 && (count ?? 0) >= MIN_EVOLVE_POSITIONS) {
    await evolveThresholds();
  }

  // Trigger Darwinian signal weight recalculation if enabled
  if (config.darwin?.enabled) {
    try {
      const { data: perfRows } = await supabase.from("performance").select("*");
      await recalculateWeights(perfRows ?? [], config);
    } catch (e: any) {
      log("signal_weights", `Recalc skipped: ${e.message}`);
    }
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
  const volatility = entry.volatility ?? 0;
  const efficiency = entry.range_efficiency;
  const il = entry.il_usd ?? 0;
  const fees = entry.fees_earned_usd ?? 0;
  const feeIlRatio = entry.fee_to_il_ratio ?? 0;

  let rule: string;
  const tags: string[] = [outcome];

  if (outcome === "good") {
    rule = `WORKED: ${pool} ${strategy} → +${pnl.toFixed(1)}%, ${efficiency}% in-range`;
    if (il > 0) rule += `, fees $${fees} > IL $${il} (ratio ${feeIlRatio}x)`;
    tags.push("worked", "screening");
  } else if (outcome === "bad") {
    rule = `AVOID: ${pool} (vol=${volatility}, ${strategy}) → ${pnl.toFixed(1)}%, ${efficiency}% in-range`;
    if (il > 0)
      rule += `, IL $${il} destroyed fees $${fees} (ratio ${feeIlRatio}x)`;
    if (entry.close_reason) rule += `. Reason: ${entry.close_reason}`;
    tags.push("failed", "screening", "il_loss");
  } else {
    rule = `FAILED: ${pool} ${strategy} → ${pnl.toFixed(1)}%, ${efficiency}% in-range`;
    if (il > 0) rule += `, IL $${il} vs fees $${fees}`;
    if (entry.close_reason) rule += `. Reason: ${entry.close_reason}`;
    tags.push("failed");
  }

  return { rule, tags, outcome, pinned: false, role: null as string | null };
}

export async function addLesson(
  rule: string,
  tags: string[] = [],
  opts?: { pinned?: boolean; role?: string | null },
) {
  const { error } = await supabase.from("lessons").insert({
    rule,
    tags,
    pinned: opts?.pinned ?? false,
    role: opts?.role ?? null,
  });
  if (error) throw error;
}

export async function pinLesson(id: number) {
  const { error } = await supabase
    .from("lessons")
    .update({ pinned: true })
    .eq("id", id);
  if (error) throw error;
  return { pinned: true, id };
}

export async function unpinLesson(id: number) {
  const { error } = await supabase
    .from("lessons")
    .update({ pinned: false })
    .eq("id", id);
  if (error) throw error;
  return { unpinned: true, id };
}

export async function listLessons(opts?: {
  role?: string;
  pinned?: boolean;
  tag?: string;
  limit?: number;
}) {
  const { data: allData, error } = await supabase.from("lessons").select("*");
  if (error) throw error;
  const all = allData ?? [];

  let lessons = [...all].sort(
    (a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  if (opts?.pinned !== undefined)
    lessons = lessons.filter((lesson: any) => lesson.pinned === opts.pinned);
  if (opts?.role)
    lessons = lessons.filter((lesson: any) => lesson.role === opts.role);
  if (opts?.tag)
    lessons = lessons.filter(
      (lesson: any) =>
        Array.isArray(lesson.tags) && lesson.tags.includes(opts.tag),
    );
  lessons = lessons.slice(0, opts?.limit ?? 50);

  return { total: lessons.length, lessons };
}

export async function clearAllLessons(): Promise<number> {
  const { data, error } = await supabase.from("lessons").delete().select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function clearPerformance(): Promise<number> {
  const { data, error } = await supabase
    .from("performance")
    .delete()
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function removeLessonsByKeyword(keyword: string): Promise<number> {
  const { data: allData, error } = await supabase
    .from("lessons")
    .select("id, rule");
  if (error) throw error;
  const all = allData ?? [];
  const toDelete = all.filter((lesson: any) =>
    lesson.rule.toLowerCase().includes(keyword.toLowerCase()),
  );
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("lessons")
      .delete()
      .in(
        "id",
        toDelete.map((lesson: any) => lesson.id),
      );
    if (deleteError) throw deleteError;
  }
  return toDelete.length;
}

const SCREENER_TAGS = [
  "screening",
  "narrative",
  "strategy",
  "deployment",
  "token",
  "volume",
  "entry",
  "bundler",
  "holders",
  "organic",
];
const MANAGER_TAGS = [
  "management",
  "risk",
  "oor",
  "fees",
  "position",
  "hold",
  "close",
  "pnl",
  "rebalance",
  "claim",
];

export async function getLessonsForPrompt(
  opts: { agentType?: string; maxLessons?: number } = {},
): Promise<string> {
  const maxLessons = opts.maxLessons ?? 20;
  const agentType = opts.agentType ?? "GENERAL";

  const { data: allLessonsData, error } = await supabase
    .from("lessons")
    .select("*");
  if (error) throw error;
  const allLessons = allLessonsData ?? [];

  const sorted = [...allLessons].sort(
    (a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const pinned = sorted.filter((lesson: any) => lesson.pinned).slice(0, 5);

  const roleTags =
    agentType === "SCREENER"
      ? SCREENER_TAGS
      : agentType === "MANAGER"
        ? MANAGER_TAGS
        : [];
  const roleMatched =
    roleTags.length > 0
      ? sorted
          .filter(
            (lesson: any) =>
              !lesson.pinned &&
              Array.isArray(lesson.tags) &&
              lesson.tags.some((tag: string) => roleTags.includes(tag)),
          )
          .slice(0, 6)
      : [];

  const usedIds = new Set([
    ...pinned.map((lesson: any) => lesson.id),
    ...roleMatched.map((lesson: any) => lesson.id),
  ]);
  const remaining = maxLessons - pinned.length - roleMatched.length;
  const recent =
    remaining > 0
      ? sorted
          .filter((lesson: any) => !usedIds.has(lesson.id))
          .slice(0, remaining)
      : [];

  const sections: string[] = [];
  if (pinned.length) {
    sections.push(`── PINNED (${pinned.length}) ──`);
    pinned.forEach((lesson: any) =>
      sections.push(
        `📌 [${lesson.outcome?.toUpperCase() ?? ""}] ${lesson.rule}`,
      ),
    );
  }
  if (roleMatched.length) {
    sections.push(`── ${agentType} (${roleMatched.length}) ──`);
    roleMatched.forEach((lesson: any) =>
      sections.push(`[${lesson.outcome?.toUpperCase() ?? ""}] ${lesson.rule}`),
    );
  }
  if (recent.length) {
    sections.push(`── RECENT (${recent.length}) ──`);
    recent.forEach((lesson: any) =>
      sections.push(`[${lesson.outcome?.toUpperCase() ?? ""}] ${lesson.rule}`),
    );
  }

  return sections.join("\n");
}

export async function getPerformanceSummary() {
  const { data: allData, error } = await supabase
    .from("performance")
    .select("*");
  if (error) throw error;
  const all = allData ?? [];
  if (all.length === 0) return null;

  const totalPnl = all.reduce(
    (sum: number, row: any) => sum + (row.pnl_usd ?? 0),
    0,
  );
  const totalFees = all.reduce(
    (sum: number, row: any) => sum + (row.fees_earned_usd ?? 0),
    0,
  );
  const totalIl = all.reduce(
    (sum: number, row: any) => sum + (row.il_usd ?? 0),
    0,
  );
  const winners = all.filter((row: any) => (row.pnl_usd ?? 0) > 0).length;

  const recent = [...all]
    .sort(
      (a: any, b: any) =>
        new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
    )
    .slice(0, 5);
  const recentWins = recent.filter((row: any) => (row.pnl_usd ?? 0) > 0).length;
  const recentLosses = recent.length - recentWins;

  return {
    total_positions_closed: all.length,
    total_pnl_usd: Math.round(totalPnl * 100) / 100,
    total_fees_usd: Math.round(totalFees * 100) / 100,
    total_il_usd: Math.round(totalIl * 100) / 100,
    avg_fee_to_il_ratio:
      totalIl > 0 ? Math.round((totalFees / totalIl) * 100) / 100 : null,
    avg_pnl_pct:
      Math.round(
        (all.reduce((sum: number, row: any) => sum + (row.pnl_pct ?? 0), 0) /
          all.length) *
          100,
      ) / 100,
    win_rate_pct: Math.round((winners / all.length) * 100),
    recent_streak: { wins: recentWins, losses: recentLosses },
  };
}

export async function getPerformanceHistory(opts?: {
  hours?: number;
  limit?: number;
}) {
  const { data: allData, error } = await supabase
    .from("performance")
    .select("*");
  if (error) throw error;
  const all = allData ?? [];

  let rows = [...all];
  if (opts?.hours) {
    const since = Date.now() - opts.hours * 3600_000;
    rows = rows.filter(
      (row: any) => new Date(row.recorded_at).getTime() >= since,
    );
  }

  rows.sort(
    (a: any, b: any) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  );
  return rows.slice(0, opts?.limit ?? 100);
}

export async function evolveThresholds() {
  const { data: allData, error } = await supabase
    .from("performance")
    .select("*");
  if (error) throw error;
  const all = allData ?? [];
  if (all.length < MIN_EVOLVE_POSITIONS) return null;

  const winners = all.filter((row: any) => (row.pnl_pct ?? 0) > 0);
  const losers = all.filter((row: any) => (row.pnl_pct ?? 0) < -5);

  if (winners.length < 2 && losers.length < 2) return null;

  const changes: Record<string, number> = {};
  const rationale: Record<string, string> = {};
  const screening = config.screening;

  if (winners.length >= 2 && losers.length >= 2) {
    const avgWinOrganic = avg(
      winners.map((row: any) => row.organic_score).filter(isNum),
    );
    const avgLoseOrganic = avg(
      losers.map((row: any) => row.organic_score).filter(isNum),
    );
    if (
      avgWinOrganic != null &&
      avgLoseOrganic != null &&
      avgWinOrganic > avgLoseOrganic
    ) {
      const newVal = clampChange(
        screening.minOrganic,
        avgLoseOrganic + (avgWinOrganic - avgLoseOrganic) * 0.3,
        MAX_CHANGE_PER_STEP,
      );
      if (Math.abs(newVal - screening.minOrganic) > 1) {
        changes.minOrganic = Math.round(newVal);
        rationale.minOrganic = `${screening.minOrganic} → ${Math.round(newVal)} (winners avg ${avgWinOrganic}, losers avg ${avgLoseOrganic})`;
      }
    }
  }

  if (Object.keys(changes).length === 0) return null;

  for (const [key, value] of Object.entries(changes)) {
    (screening as Record<string, unknown>)[key] = value;
  }
  await saveConfig({ ...changes, _lastEvolution: new Date().toISOString() });

  const summary = Object.entries(changes)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  await addLesson(`[EVOLVED] Thresholds adjusted: ${summary}`, [
    "evolution",
    "self_tune",
  ]);

  log("lessons", `Thresholds evolved: ${JSON.stringify(changes)}`);
  return { changes, rationale };
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

function clampChange(current: number, target: number, maxPct: number): number {
  const maxDelta = current * maxPct;
  const delta = target - current;
  return current + Math.max(-maxDelta, Math.min(maxDelta, delta));
}
