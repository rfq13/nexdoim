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
import { executeTool } from "./tools/executor";
import { sendHTML, notifyDeploy } from "./telegram";

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
 */
export async function approvePendingDecision(id: number, resolvedBy: "web" | "telegram"): Promise<ApprovalResult> {
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

  // Announce approval to Telegram (dual-channel visibility)
  const sourceLabel = resolvedBy === "web" ? "web UI" : "Telegram";
  await sendHTML(
    `🟢 <b>Approved via ${sourceLabel}</b> — <code>#${claimed.id}</code>\nExecuting ${claimed.action}: ${claimed.pool_name ?? claimed.pool_address?.slice(0, 8) ?? "?"}...`,
  ).catch(() => {});

  // Execute the underlying tool
  const toolName = claimed.action === "deploy" ? "deploy_position" : "close_position";
  let execution: any;
  try {
    execution = await executeTool(toolName, claimed.args);
  } catch (e: any) {
    execution = { error: e?.message ?? String(e) };
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

  const sourceLabel = resolvedBy === "web" ? "web UI" : "Telegram";
  await sendHTML(
    `🔴 <b>Rejected via ${sourceLabel}</b> — <code>#${claimed.id}</code>\n${claimed.action}: ${claimed.pool_name ?? claimed.pool_address?.slice(0, 8) ?? "?"}${reason ? `\nAlasan: ${reason}` : ""}`,
  ).catch(() => {});

  return {
    success: true,
    status: "rejected",
    decision: claimed,
  };
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
