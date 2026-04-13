/**
 * HITL pending decisions — deploy/close recommendations from the agent
 * that need human approval before execution.
 *
 * Approval is race-safe via a conditional UPDATE: the first actor to flip
 * status from `pending` → `approved` wins; any second actor (e.g. another
 * tab, another channel like Telegram) gets `null` back and a "not pending"
 * response.
 */
import { supabase } from "./db";
import { log } from "./logger";
import { executeTool, runSafetyChecks } from "./tools/executor";
import { sendHTML } from "./telegram";
import { config, computeDeployAmount, computeBinRange } from "./config";
import { getWalletBalances } from "./tools/wallet";

export type PendingStatus = "pending" | "approved" | "executed" | "rejected" | "failed" | "expired";

export interface PendingDecision {
  id: number;
  created_at: string;
  expires_at: string;
  status: PendingStatus;
  action: "deploy" | "close";
  pool_address: string | null;
  pool_name: string | null;
  args: Record<string, any>;
  reason: string | null;
  risks: string[] | null;
  source_run_id: number | null;
  resolved_at: string | null;
  resolved_by: string | null;
  result: any;
  error: string | null;
}

// ─── CRUD ────────────────────────────────────────────────────
export async function createPendingDecision(input: {
  action: "deploy" | "close";
  pool_address?: string;
  pool_name?: string;
  args: Record<string, any>;
  reason?: string;
  risks?: string[];
  source_run_id?: number;
}): Promise<PendingDecision | null> {
  const { data, error } = await supabase
    .from("pending_decisions")
    .insert({
      action: input.action,
      pool_address: input.pool_address ?? null,
      pool_name: input.pool_name ?? null,
      args: input.args,
      reason: input.reason ?? null,
      risks: input.risks ?? [],
      source_run_id: input.source_run_id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    log("pending_error", `Failed to create pending decision: ${error.message}`);
    return null;
  }
  return data as PendingDecision;
}

export async function listPendingDecisions(status: PendingStatus | null = "pending", limit = 20) {
  let query = supabase
    .from("pending_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    log("pending_error", `Failed to list pending decisions: ${error.message}`);
    return [];
  }
  return (data ?? []) as PendingDecision[];
}

export async function getPendingDecision(id: number): Promise<PendingDecision | null> {
  const { data, error } = await supabase
    .from("pending_decisions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as PendingDecision;
}

/**
 * Atomically claim a pending decision. Returns the updated row if this
 * caller won the race, or null if the row is not pending anymore.
 */
async function claimPending(id: number, newStatus: "approved" | "rejected", resolvedBy: string): Promise<PendingDecision | null> {
  const { data, error } = await supabase
    .from("pending_decisions")
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error) return null;
  return data as PendingDecision;
}

// ─── Resolution flow ──────────────────────────────────────────
export interface ApprovalResult {
  success: boolean;
  status: PendingStatus;
  error?: string;
  decision?: PendingDecision;
  execution?: any;
}

/**
 * Approve a pending decision and execute it. Atomic — safe to call
 * from both web and Telegram concurrently (second caller gets a "not pending" response).
 *
 * @param reasoning — WHY the approver chose to approve. For auto-approve,
 *   this is the system-generated justification from safety checks.
 */
export async function approvePendingDecision(id: number, resolvedBy: "web" | "telegram" | "auto", reasoning?: string): Promise<ApprovalResult> {
  const claimed = await claimPending(id, "approved", resolvedBy);
  if (!claimed) {
    const current = await getPendingDecision(id);
    return {
      success: false,
      status: current?.status ?? "pending",
      error: current
        ? `Decision #${id} sudah ${current.status} (resolved by ${current.resolved_by ?? "?"})`
        : `Decision #${id} tidak ditemukan`,
    };
  }

  // Persist reasoning alongside the decision row
  if (reasoning) {
    await supabase.from("pending_decisions")
      .update({ error: `Approved: ${reasoning}` })
      .eq("id", id)
      .then(() => {}, () => {});
  }

  // Announce approval to Telegram (dual-channel visibility)
  const sourceLabels: Record<string, string> = { web: "web UI", telegram: "Telegram", auto: "Auto-Deploy" };
  const sourceLabel = sourceLabels[resolvedBy] ?? resolvedBy;
  const reasonLine = reasoning ? `\nAlasan: ${reasoning}` : "";
  await sendHTML(
    `🟢 <b>Approved via ${sourceLabel}</b> — <code>#${claimed.id}</code>\nExecuting ${claimed.action}: ${claimed.pool_name ?? claimed.pool_address?.slice(0, 8) ?? "?"}${reasonLine}`,
  ).catch(() => {});

  // Execute the underlying tool
  const toolName = claimed.action === "deploy" ? "deploy_position" : "close_position";
  let execution: any;
  try {
    if (claimed.args?.rebalance && claimed.args?.pool_address) {
      const vol = claimed.args.volatility ?? 3;
      const binStep = claimed.args.bin_step ?? 80;
      const wallet = await getWalletBalances();
      const amount = computeDeployAmount(wallet.sol, vol);
      const bins = computeBinRange(vol, binStep);
      const rebalanceSafety = await runSafetyChecks("deploy_position", {
        pool_address: claimed.args.pool_address,
        pool_name: claimed.pool_name,
        amount_y: amount,
        bins_below: bins.binsBelow,
        bins_above: bins.binsAbove,
        strategy: "bid_ask",
        bin_step: binStep,
        volatility: vol,
      });

      if (!rebalanceSafety.pass) {
        execution = { blocked: true, reason: `Rebalance dibatalkan sebelum close: ${rebalanceSafety.reason}` };
        throw new Error(rebalanceSafety.reason ?? "rebalance preflight failed");
      }
    }

    execution = await executeTool(toolName, claimed.args);
  } catch (e: any) {
    execution = { error: e?.message ?? String(e) };
  }

  // If this is a rebalance (close + redeploy), trigger redeploy after successful close
  if (!execution?.error && !execution?.blocked && claimed.args?.rebalance && claimed.args?.pool_address) {
    try {
      const vol = claimed.args.volatility ?? 3;
      const binStep = claimed.args.bin_step ?? 80;
      const wallet = await getWalletBalances();
      const amount = computeDeployAmount(wallet.sol, vol);
      const bins = computeBinRange(vol, binStep);

      const redeployResult = await executeTool("deploy_position", {
        pool_address: claimed.args.pool_address,
        pool_name: claimed.pool_name,
        amount_y: amount,
        bins_below: bins.binsBelow,
        bins_above: bins.binsAbove,
        strategy: "bid_ask",
        bin_step: binStep,
        volatility: vol,
      });

      if (redeployResult?.error || redeployResult?.blocked) {
        log("rebalance", `Redeploy after rebalance failed: ${redeployResult?.error ?? redeployResult?.reason}`);
      } else {
        log("rebalance", `Redeploy success for ${claimed.pool_name} — new position at current active bin`);
        execution.rebalance_deploy = redeployResult;
      }
    } catch (e: any) {
      log("rebalance_error", `Redeploy failed: ${e?.message}`);
    }
  }

  const failed = execution?.error || execution?.blocked;
  const finalStatus: PendingStatus = failed ? "failed" : "executed";
  const errorMsg = execution?.error || (execution?.blocked ? `blocked: ${execution.reason}` : null);

  const { data: updated } = await supabase
    .from("pending_decisions")
    .update({
      status: finalStatus,
      result: execution,
      error: errorMsg,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (failed) {
    await sendHTML(
      `❌ <b>Execution failed</b> — <code>#${id}</code>\n${errorMsg}`,
    ).catch(() => {});
    return {
      success: false,
      status: finalStatus,
      error: errorMsg ?? "execution failed",
      decision: (updated ?? claimed) as PendingDecision,
      execution,
    };
  }

  // Note: executeTool("deploy_position", ...) already calls notifyDeploy()
  // internally on success via the executor, so we don't double-notify here.
  return {
    success: true,
    status: finalStatus,
    decision: (updated ?? claimed) as PendingDecision,
    execution,
  };
}

export async function rejectPendingDecision(id: number, resolvedBy: "web" | "telegram", reason?: string): Promise<ApprovalResult> {
  const claimed = await claimPending(id, "rejected", resolvedBy);
  if (!claimed) {
    const current = await getPendingDecision(id);
    return {
      success: false,
      status: current?.status ?? "pending",
      error: current
        ? `Decision #${id} sudah ${current.status} (resolved by ${current.resolved_by ?? "?"})`
        : `Decision #${id} tidak ditemukan`,
    };
  }

  if (reason) {
    const { data: updated } = await supabase
      .from("pending_decisions")
      .update({ error: `Rejected: ${reason}` })
      .eq("id", id)
      .select("*")
      .single();
    if (updated) Object.assign(claimed, updated);
  }

  const sourceLabels: Record<string, string> = { web: "web UI", telegram: "Telegram", auto: "Auto-Safety" };
  const sourceLabel = sourceLabels[resolvedBy] ?? resolvedBy;
  await sendHTML(
    `🔴 <b>Rejected via ${sourceLabel}</b> — <code>#${claimed.id}</code>\n${claimed.action}: ${claimed.pool_name ?? claimed.pool_address?.slice(0, 8) ?? "?"}${reason ? `\nAlasan: ${reason}` : ""}`,
  ).catch(() => {});

  return {
    success: true,
    status: "rejected",
    decision: claimed,
  };
}

// ─── Auto-Deploy Orchestrator ─────────────────────────────────

interface AutoDeployCheck {
  allowed: boolean;
  reasoning: string;
}

async function checkAutoDeployRateLimit(): Promise<AutoDeployCheck> {
  const maxHour = config.safety.autoDeployMaxPerHour;
  const maxDay = config.safety.autoDeployMaxPerDay;

  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [hourResult, dayResult] = await Promise.all([
    supabase.from("pending_decisions")
      .select("id", { count: "exact" })
      .eq("resolved_by", "auto")
      .eq("action", "deploy")
      .in("status", ["approved", "executed"])
      .gte("resolved_at", oneHourAgo),
    supabase.from("pending_decisions")
      .select("id", { count: "exact" })
      .eq("resolved_by", "auto")
      .eq("action", "deploy")
      .in("status", ["approved", "executed"])
      .gte("resolved_at", dayStart.toISOString()),
  ]);

  const hourCount = hourResult.count ?? 0;
  const dayCount = dayResult.count ?? 0;

  if (hourCount >= maxHour) {
    return { allowed: false, reasoning: `Rate limit per jam tercapai (${hourCount}/${maxHour})` };
  }
  if (dayCount >= maxDay) {
    return { allowed: false, reasoning: `Rate limit per hari tercapai (${dayCount}/${maxDay})` };
  }

  return {
    allowed: true,
    reasoning: `Rate limit OK (jam: ${hourCount}/${maxHour}, hari: ${dayCount}/${maxDay})`,
  };
}

/**
 * Try to auto-approve a pending decision if autoDeploy is enabled and
 * all safety gates pass. Returns the reasoning for whatever happened
 * (approved, rate-limited, bearish-blocked, etc.).
 *
 * Called from runScreeningCycle after creating a pending_decision row.
 */
export async function tryAutoApprove(id: number, marketRegime: string): Promise<{
  autoApproved: boolean;
  reasoning: string;
}> {
  if (!config.safety.autoDeploy) {
    return { autoApproved: false, reasoning: "Auto-deploy dimatikan — menunggu konfirmasi manual" };
  }

  // Gate: bearish market
  if (config.safety.autoDeployRequireNoBearish && marketRegime === "BEARISH") {
    return { autoApproved: false, reasoning: "Market BEARISH + autoDeployRequireNoBearish=true — butuh konfirmasi manual" };
  }

  // Gate: rate limit
  const rateCheck = await checkAutoDeployRateLimit();
  if (!rateCheck.allowed) {
    return { autoApproved: false, reasoning: rateCheck.reasoning + " — butuh konfirmasi manual" };
  }

  // All gates passed — auto-approve with reasoning
  const reasoning = `Auto-deploy approved: ${rateCheck.reasoning}, market=${marketRegime}`;
  log("auto_deploy", `Auto-approving #${id}: ${reasoning}`);

  const result = await approvePendingDecision(id, "auto", reasoning);

  if (!result.success) {
    return { autoApproved: false, reasoning: `Auto-approve gagal: ${result.error}` };
  }

  return { autoApproved: true, reasoning };
}

/**
 * Check if a pending (unresolved) decision already exists for this
 * position_address or pool_address. Prevents duplicate pending rows
 * when cron cycles run repeatedly for the same asset.
 */
export async function hasPendingForPosition(positionAddress: string): Promise<boolean> {
  const { count } = await supabase
    .from("pending_decisions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .contains("args", { position_address: positionAddress });
  return (count ?? 0) > 0;
}

export async function hasPendingForPool(poolAddress: string): Promise<boolean> {
  const { count } = await supabase
    .from("pending_decisions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .eq("pool_address", poolAddress);
  return (count ?? 0) > 0;
}

/**
 * Mark all expired pending rows. Called occasionally from the cron tick.
 */
export async function expirePendingDecisions(): Promise<number> {
  const { data, error } = await supabase
    .from("pending_decisions")
    .update({
      status: "expired",
      resolved_at: new Date().toISOString(),
      resolved_by: "auto_expire",
    })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
