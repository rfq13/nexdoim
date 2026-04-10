/**
 * Darwinian signal weighting system.
 *
 * Tracks which screening signals actually predict profitable positions
 * and adjusts their weights over time. Signals that consistently appear
 * in winners get boosted; those associated with losers get decayed.
 *
 * Weights are persisted in Supabase (signal_weights table) and injected
 * into the LLM prompt so the agent can prioritize the right criteria.
 */

import { supabase } from "./db";
import { log } from "./logger";

// ─── Signal Definitions ─────────────────────────────────────────

export const SIGNAL_NAMES = [
  "organic_score",
  "fee_tvl_ratio",
  "volume",
  "mcap",
  "holder_count",
  "smart_wallets_present",
  "narrative_quality",
  "study_win_rate",
  "hive_consensus",
  "volatility",
] as const;

export type SignalName = typeof SIGNAL_NAMES[number];

export interface WeightChangeRecord {
  timestamp: string;
  changes: { signal: string; from: number; to: number; lift: number; action: string }[];
  window_size: number;
  win_count: number;
  loss_count: number;
}

export interface SignalWeightsData {
  weights: Record<string, number>;
  last_recalc_at: string | null;
  recalc_count: number;
  history: WeightChangeRecord[];
}

const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(SIGNAL_NAMES.map((s) => [s, 1.0]));

// Signals where higher values generally indicate better candidates
const HIGHER_IS_BETTER = new Set([
  "organic_score",
  "fee_tvl_ratio",
  "volume",
  "holder_count",
  "study_win_rate",
  "hive_consensus",
]);

// Boolean signals — compared by win rate when present vs absent
const BOOLEAN_SIGNALS = new Set(["smart_wallets_present"]);

// Categorical signals — compared by win rate across categories
const CATEGORICAL_SIGNALS = new Set(["narrative_quality"]);

// ─── Persistence ─────────────────────────────────────────────────

export async function loadWeights(): Promise<SignalWeightsData> {
  const { data, error } = await supabase
    .from("signal_weights")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return { weights: { ...DEFAULT_WEIGHTS }, last_recalc_at: null, recalc_count: 0, history: [] };
  }

  const weights: Record<string, number> = data.weights || {};
  for (const name of SIGNAL_NAMES) {
    if (weights[name] == null) weights[name] = 1.0;
  }

  return {
    weights,
    last_recalc_at: data.last_recalc_at ?? null,
    recalc_count: data.recalc_count ?? 0,
    history: data.history ?? [],
  };
}

export async function saveWeights(d: SignalWeightsData): Promise<void> {
  const { error } = await supabase
    .from("signal_weights")
    .upsert({
      id: 1,
      weights: d.weights,
      last_recalc_at: d.last_recalc_at,
      recalc_count: d.recalc_count,
      history: d.history,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (error) log("signal_weights_error", `Failed to save weights: ${error.message}`);
}

// ─── Core Algorithm ──────────────────────────────────────────────

export async function recalculateWeights(
  perfData: any[],
  cfg?: any,
): Promise<{ changes: WeightChangeRecord["changes"]; weights: Record<string, number> }> {
  const darwin = (cfg as any)?.darwin ?? {};
  const windowDays    = darwin.windowDays    ?? 60;
  const minSamples    = darwin.minSamples    ?? 10;
  const boostFactor   = darwin.boostFactor   ?? 1.05;
  const decayFactor   = darwin.decayFactor   ?? 0.95;
  const weightFloor   = darwin.weightFloor   ?? 0.3;
  const weightCeiling = darwin.weightCeiling ?? 2.5;

  const data = await loadWeights();
  const weights = { ...data.weights };

  for (const name of SIGNAL_NAMES) {
    if (weights[name] == null) weights[name] = 1.0;
  }

  // Filter to rolling window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffISO = cutoff.toISOString();

  const recent = perfData.filter((p) => {
    const ts = p.recorded_at || p.closed_at || p.deployed_at;
    return ts && ts >= cutoffISO;
  });

  if (recent.length < minSamples) {
    log("signal_weights", `Only ${recent.length} records in ${windowDays}d window (need ${minSamples}), skipping recalc`);
    return { changes: [], weights };
  }

  const wins   = recent.filter((p) => (p.pnl_usd ?? 0) > 0);
  const losses = recent.filter((p) => (p.pnl_usd ?? 0) <= 0);

  if (wins.length === 0 || losses.length === 0) {
    log("signal_weights", `Need both wins (${wins.length}) and losses (${losses.length}), skipping`);
    return { changes: [], weights };
  }

  const lifts: Record<string, number> = {};
  for (const signal of SIGNAL_NAMES) {
    const lift = computeLift(signal, wins, losses, minSamples);
    if (lift !== null) lifts[signal] = lift;
  }

  const ranked = Object.entries(lifts).sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    log("signal_weights", "No signals had enough samples for lift calculation");
    return { changes: [], weights };
  }

  const q1End    = Math.ceil(ranked.length * 0.25);
  const q3Start  = Math.floor(ranked.length * 0.75);
  const topQuartile    = new Set(ranked.slice(0, q1End).map(([name]) => name));
  const bottomQuartile = new Set(ranked.slice(q3Start).map(([name]) => name));

  const changes: WeightChangeRecord["changes"] = [];
  for (const [signal, lift] of ranked) {
    const prev = weights[signal];
    let next = prev;

    if (topQuartile.has(signal)) {
      next = Math.min(prev * boostFactor, weightCeiling);
    } else if (bottomQuartile.has(signal)) {
      next = Math.max(prev * decayFactor, weightFloor);
    }

    next = Math.round(next * 1000) / 1000;

    if (next !== prev) {
      const dir = next > prev ? "boosted" : "decayed";
      changes.push({ signal, from: prev, to: next, lift: Math.round(lift * 1000) / 1000, action: dir });
      weights[signal] = next;
      log("signal_weights", `${signal}: ${prev} -> ${next} (${dir}, lift=${lift.toFixed(3)})`);
    }
  }

  const now = new Date().toISOString();
  data.weights = weights;
  data.last_recalc_at = now;
  data.recalc_count = (data.recalc_count || 0) + 1;

  if (changes.length > 0) {
    const entry: WeightChangeRecord = {
      timestamp: now,
      changes,
      window_size: recent.length,
      win_count: wins.length,
      loss_count: losses.length,
    };
    data.history = [...(data.history || []), entry].slice(-20);
  }

  await saveWeights(data);

  log("signal_weights", changes.length > 0
    ? `Recalculated: ${changes.length} weight(s) adjusted from ${recent.length} records`
    : `Recalculated: no changes (${recent.length} records, ${ranked.length} signals evaluated)`);

  return { changes, weights };
}

// ─── Lift Computation ────────────────────────────────────────────

function computeLift(signal: string, wins: any[], losses: any[], minSamples: number): number | null {
  if (BOOLEAN_SIGNALS.has(signal))     return computeBooleanLift(signal, wins, losses, minSamples);
  if (CATEGORICAL_SIGNALS.has(signal)) return computeCategoricalLift(signal, wins, losses, minSamples);
  return computeNumericLift(signal, wins, losses, minSamples);
}

function computeNumericLift(signal: string, wins: any[], losses: any[], minSamples: number): number | null {
  const winVals  = extractNumeric(signal, wins);
  const lossVals = extractNumeric(signal, losses);
  if (winVals.length + lossVals.length < minSamples) return null;
  if (winVals.length === 0 || lossVals.length === 0) return null;

  const all = [...winVals, ...lossVals];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min;
  if (range === 0) return 0;

  const normalize = (v: number) => (v - min) / range;
  const winMean  = mean(winVals.map(normalize));
  const lossMean = mean(lossVals.map(normalize));

  return HIGHER_IS_BETTER.has(signal) ? winMean - lossMean : Math.abs(winMean - lossMean);
}

function computeBooleanLift(signal: string, wins: any[], losses: any[], minSamples: number): number | null {
  const all = [...wins.map((w) => ({ w: true, snap: w })), ...losses.map((l) => ({ w: false, snap: l }))];
  let trueWins = 0, trueTotal = 0, falseWins = 0, falseTotal = 0;

  for (const { w, snap } of all) {
    const val = snap.signal_snapshot?.[signal];
    if (val === undefined || val === null) continue;
    if (val) { trueTotal++; if (w) trueWins++; }
    else      { falseTotal++; if (w) falseWins++; }
  }

  if (trueTotal + falseTotal < minSamples) return null;
  if (trueTotal === 0 || falseTotal === 0) return null;
  return (trueWins / trueTotal) - (falseWins / falseTotal);
}

function computeCategoricalLift(signal: string, wins: any[], losses: any[], minSamples: number): number | null {
  const all = [...wins.map((w) => ({ w: true, snap: w })), ...losses.map((l) => ({ w: false, snap: l }))];
  const buckets: Record<string, { wins: number; total: number }> = {};

  for (const { w, snap } of all) {
    const val = snap.signal_snapshot?.[signal];
    if (val === undefined || val === null) continue;
    const key = String(val);
    if (!buckets[key]) buckets[key] = { wins: 0, total: 0 };
    buckets[key].total++;
    if (w) buckets[key].wins++;
  }

  const totalSamples = Object.values(buckets).reduce((s, b) => s + b.total, 0);
  if (totalSamples < minSamples) return null;

  const rates = Object.values(buckets).filter((b) => b.total >= 2).map((b) => b.wins / b.total);
  if (rates.length < 2) return null;
  return Math.max(...rates) - Math.min(...rates);
}

function extractNumeric(signal: string, entries: any[]): number[] {
  const vals: number[] = [];
  for (const entry of entries) {
    const snap = entry.signal_snapshot;
    if (!snap) continue;
    const v = snap[signal];
    if (v != null && typeof v === "number" && isFinite(v)) vals.push(v);
  }
  return vals;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ─── Summary for LLM Prompt Injection ────────────────────────────

export async function getWeightsSummary(): Promise<string> {
  const data = await loadWeights();
  const w = data.weights || {};

  const lines = ["Signal Weights (Darwinian — learned from past positions):"];
  const sorted = [...SIGNAL_NAMES]
    .filter((s) => w[s] != null)
    .sort((a, b) => (w[b] ?? 1) - (w[a] ?? 1));

  for (const signal of sorted) {
    const val = w[signal] ?? 1.0;
    const label = interpretWeight(val);
    const bar   = weightBar(val);
    lines.push(`  ${signal.padEnd(24)} ${val.toFixed(2)}  ${bar}  ${label}`);
  }

  if (data.last_recalc_at) {
    lines.push(`\nLast recalculated: ${data.last_recalc_at} (${data.recalc_count || 0} total)`);
  } else {
    lines.push("\nWeights have not been recalculated yet (using defaults — need 10+ closed positions).");
  }

  return lines.join("\n");
}

function interpretWeight(val: number): string {
  if (val >= 1.8) return "[STRONG]";
  if (val >= 1.2) return "[above avg]";
  if (val >= 0.8) return "[neutral]";
  if (val >= 0.5) return "[below avg]";
  return "[weak]";
}

function weightBar(val: number): string {
  const filled  = Math.round(((val - 0.3) / (2.5 - 0.3)) * 10);
  const clamped = Math.max(0, Math.min(10, filled));
  return "#".repeat(clamped) + ".".repeat(10 - clamped);
}
