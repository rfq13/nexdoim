/**
 * Goals & Targets — tracks PnL targets with deadlines.
 * Calculates progress, daily run-rate, and proposes config adjustments
 * when the user is behind/ahead of target.
 */
import { supabase } from "./db";
import { log } from "./logger";
import { config } from "./config";

export interface Goal {
  id: number;
  created_at: string;
  title: string;
  target_pnl: number;
  currency: string;
  start_date: string;
  end_date: string;
  status: "active" | "paused" | "completed" | "failed" | "cancelled";
  notes: string | null;
  current_pnl: number;
  last_sync_at: string | null;
  proposed_adjustments: ProposedAdjustments | null;
  updated_at: string;
}

export interface GoalProgress {
  goal: Goal;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  pct_time_elapsed: number;
  pct_pnl_achieved: number;
  daily_rate_needed: number;
  daily_rate_actual: number;
  on_track: boolean;
  pace_label: "ahead" | "on_track" | "behind" | "critical";
  gap_usd: number;
  projected_pnl: number;
}

export interface ProposedAdjustments {
  reason: string;
  changes: Record<string, Record<string, any>>;
  risk_note: string;
}

// ─── CRUD ────────────────────────────────────────────────────

export async function createGoal(input: {
  title: string;
  target_pnl: number;
  start_date?: string;
  end_date: string;
  notes?: string;
}): Promise<Goal | null> {
  const { data, error } = await supabase
    .from("goals")
    .insert({
      title: input.title,
      target_pnl: input.target_pnl,
      start_date: input.start_date ?? new Date().toISOString().slice(0, 10),
      end_date: input.end_date,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) { log("goals_error", `Create failed: ${error.message}`); return null; }
  return data as Goal;
}

export async function listGoals(status?: string): Promise<Goal[]> {
  let query = supabase.from("goals").select("*").order("created_at", { ascending: false }).limit(20);
  if (status) query = query.eq("status", status);
  const { data } = await query;
  return (data ?? []) as Goal[];
}

export async function getGoal(id: number): Promise<Goal | null> {
  const { data } = await supabase.from("goals").select("*").eq("id", id).single();
  return data as Goal | null;
}

export async function updateGoal(id: number, updates: Partial<Pick<Goal, "title" | "target_pnl" | "end_date" | "status" | "notes">>): Promise<Goal | null> {
  const { data } = await supabase
    .from("goals")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  return data as Goal | null;
}

export async function deleteGoal(id: number): Promise<boolean> {
  const { error } = await supabase.from("goals").delete().eq("id", id);
  return !error;
}

// ─── Progress Calculator ─────────────────────────────────────

export async function syncGoalProgress(goal: Goal): Promise<GoalProgress> {
  // Fetch actual PnL from performance + open positions
  const [perfRes, posRes] = await Promise.all([
    supabase.from("performance")
      .select("pnl_usd, fees_earned_usd")
      .gte("recorded_at", goal.start_date),
    supabase.from("positions")
      .select("*"),
  ]);

  // Closed positions PnL since goal start
  const closedPnl = (perfRes.data ?? []).reduce(
    (sum: number, row: any) => sum + (row.pnl_usd ?? 0), 0
  );

  // Approximate open positions PnL from cache — we don't want to hit
  // RPC here, so just use last-known values from the positions API.
  let openPnl = 0;
  try {
    const { getMyPositions } = await import("./tools/dlmm");
    const posData = await getMyPositions();
    openPnl = (posData.positions ?? []).reduce(
      (sum: number, p: any) => sum + (p.pnl_usd ?? 0), 0
    );
  } catch { /* silent */ }

  const currentPnl = Math.round((closedPnl + openPnl) * 100) / 100;

  // Update DB
  await supabase.from("goals").update({
    current_pnl: currentPnl,
    last_sync_at: new Date().toISOString(),
  }).eq("id", goal.id);

  // Compute progress
  const startDate = new Date(goal.start_date);
  const endDate = new Date(goal.end_date);
  const now = new Date();
  const daysTotal = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000));
  const daysElapsed = Math.max(0, Math.ceil((now.getTime() - startDate.getTime()) / 86_400_000));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const pctTimeElapsed = Math.min(100, (daysElapsed / daysTotal) * 100);
  const pctPnlAchieved = goal.target_pnl > 0 ? Math.min(100, (currentPnl / goal.target_pnl) * 100) : 0;
  const dailyRateActual = daysElapsed > 0 ? currentPnl / daysElapsed : 0;
  const dailyRateNeeded = daysRemaining > 0 ? (goal.target_pnl - currentPnl) / daysRemaining : 0;
  const projectedPnl = dailyRateActual * daysTotal;
  const gap = goal.target_pnl - currentPnl;

  let paceLabel: GoalProgress["pace_label"] = "on_track";
  if (pctPnlAchieved >= pctTimeElapsed + 10) paceLabel = "ahead";
  else if (pctPnlAchieved < pctTimeElapsed - 30) paceLabel = "critical";
  else if (pctPnlAchieved < pctTimeElapsed - 10) paceLabel = "behind";

  return {
    goal: { ...goal, current_pnl: currentPnl },
    days_total: daysTotal,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    pct_time_elapsed: Math.round(pctTimeElapsed * 10) / 10,
    pct_pnl_achieved: Math.round(pctPnlAchieved * 10) / 10,
    daily_rate_needed: Math.round(dailyRateNeeded * 100) / 100,
    daily_rate_actual: Math.round(dailyRateActual * 100) / 100,
    on_track: paceLabel === "ahead" || paceLabel === "on_track",
    pace_label: paceLabel,
    gap_usd: Math.round(gap * 100) / 100,
    projected_pnl: Math.round(projectedPnl * 100) / 100,
  };
}

// ─── Strategy Analyzer ───────────────────────────────────────

export function analyzeStrategy(progress: GoalProgress): ProposedAdjustments | null {
  const { pace_label, daily_rate_needed, daily_rate_actual, days_remaining, gap_usd } = progress;

  if (pace_label === "ahead" || pace_label === "on_track") return null;

  const multiplier = daily_rate_needed > 0 && daily_rate_actual > 0
    ? daily_rate_needed / daily_rate_actual
    : 2;

  if (pace_label === "behind") {
    return {
      reason: `Behind target: butuh $${daily_rate_needed.toFixed(0)}/hari tapi baru $${daily_rate_actual.toFixed(0)}/hari. Gap: $${gap_usd.toFixed(0)} dalam ${days_remaining} hari.`,
      changes: {
        risk: {
          maxPositions: Math.min(config.risk.maxPositions + 1, 5),
        },
        screening: {
          minMcap: Math.max(Math.round(config.screening.minMcap * 0.7), 30_000),
          minTvl: Math.max(Math.round(config.screening.minTvl * 0.8), 2_000),
          minVolume: Math.max(Math.round(config.screening.minVolume * 0.7), 100),
        },
        schedule: {
          screeningIntervalMin: Math.max(config.schedule.screeningIntervalMin - 5, 10),
        },
      },
      risk_note: `Memperbanyak posisi +1, melonggarkan filter (mcap/tvl/volume turun ~20-30%), screening lebih sering. Risiko: exposure lebih tinggi.`,
    };
  }

  // critical
  return {
    reason: `Critical gap: butuh ${multiplier.toFixed(1)}x percepatan. $${daily_rate_needed.toFixed(0)}/hari vs actual $${daily_rate_actual.toFixed(0)}/hari. Gap: $${gap_usd.toFixed(0)} dalam ${days_remaining} hari.`,
    changes: {
      risk: {
        maxPositions: Math.min(config.risk.maxPositions + 2, 7),
      },
      management: {
        deployAmountSol: Math.min(config.management.deployAmountSol * 1.5, config.risk.maxDeployAmount),
        positionSizePct: Math.min(config.management.positionSizePct * 1.3, 0.6),
      },
      screening: {
        minMcap: Math.max(Math.round(config.screening.minMcap * 0.5), 20_000),
        minTvl: Math.max(Math.round(config.screening.minTvl * 0.6), 1_000),
        minVolume: Math.max(Math.round(config.screening.minVolume * 0.5), 50),
        minOrganic: Math.max(config.screening.minOrganic - 10, 30),
      },
      schedule: {
        screeningIntervalMin: Math.max(config.schedule.screeningIntervalMin - 10, 5),
      },
    },
    risk_note: `Agresif: posisi +2, deploy size +50%, filter dilonggarkan signifikan, screening sangat sering. Risiko tinggi — monitor ketat.`,
  };
}

// ─── Prompt context builder ──────────────────────────────────

export async function getGoalContextForPrompt(): Promise<string | null> {
  const activeGoals = await listGoals("active");
  if (activeGoals.length === 0) return null;

  const blocks: string[] = [];
  for (const goal of activeGoals.slice(0, 2)) {
    const progress = await syncGoalProgress(goal);
    const analysis = analyzeStrategy(progress);

    blocks.push([
      `GOAL: ${goal.title}`,
      `  Target: $${goal.target_pnl} by ${goal.end_date}`,
      `  Progress: $${progress.goal.current_pnl} / $${goal.target_pnl} (${progress.pct_pnl_achieved}%)`,
      `  Days: ${progress.days_elapsed}/${progress.days_total} elapsed, ${progress.days_remaining} remaining`,
      `  Rate: actual $${progress.daily_rate_actual}/day, needed $${progress.daily_rate_needed}/day`,
      `  Pace: ${progress.pace_label.toUpperCase()}${progress.on_track ? "" : " ⚠️"}`,
      `  Projected at current rate: $${progress.projected_pnl}`,
      analysis ? `  Strategy note: ${analysis.reason}` : null,
    ].filter(Boolean).join("\n"));
  }

  return blocks.join("\n\n");
}
