import { supabase } from "./db";
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
  const { error } = await supabase.from("positions").insert({
    id: data.position,
    pool: data.pool,
    pool_name: data.pool_name ?? null,
    strategy: data.strategy ?? null,
    bin_range: data.bin_range ?? null,
    amount_sol: data.amount_sol ?? null,
    amount_x: data.amount_x ?? null,
    active_bin_at_deploy: data.active_bin ?? null,
    bin_step: data.bin_step ?? null,
    volatility: data.volatility ?? null,
    fee_tvl_ratio: data.fee_tvl_ratio ?? null,
    initial_fee_tvl_24h: data.fee_tvl_ratio ?? null,
    organic_score: data.organic_score ?? null,
    initial_value_usd: data.initial_value_usd ?? null,
    notes: [],
  });

  if (error) throw error;
  await pushEvent({
    action: "deploy",
    position: data.position,
    poolName: data.pool_name ?? data.pool,
  });
  log("state", `Tracked new position: ${data.position} in pool ${data.pool}`);
}

async function getPosition(positionAddress: string) {
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("id", positionAddress)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function markOutOfRange(positionAddress: string) {
  const pos = await getPosition(positionAddress);
  if (!pos || pos.out_of_range_since) return;

  const { error } = await supabase
    .from("positions")
    .update({ out_of_range_since: new Date().toISOString() })
    .eq("id", positionAddress);

  if (error) throw error;
  log("state", `Position ${positionAddress} marked out of range`);
}

export async function markInRange(positionAddress: string) {
  const pos = await getPosition(positionAddress);
  if (!pos || !pos.out_of_range_since) return;

  const { error } = await supabase
    .from("positions")
    .update({ out_of_range_since: null })
    .eq("id", positionAddress);

  if (error) throw error;
  log("state", `Position ${positionAddress} back in range`);
}

export async function minutesOutOfRange(
  positionAddress: string,
): Promise<number> {
  const pos = await getPosition(positionAddress);
  if (!pos?.out_of_range_since) return 0;
  return Math.floor(
    (Date.now() - new Date(pos.out_of_range_since).getTime()) / 60000,
  );
}

export async function recordClaim(positionAddress: string, feesUsd: number) {
  const pos = await getPosition(positionAddress);
  if (!pos) return;

  const notes = Array.isArray(pos.notes) ? [...pos.notes] : [];
  notes.push(
    `Claimed ~$${feesUsd?.toFixed(2) ?? "?"} fees at ${new Date().toISOString()}`,
  );

  const { error } = await supabase
    .from("positions")
    .update({
      last_claim_at: new Date().toISOString(),
      total_fees_claimed_usd:
        (pos.total_fees_claimed_usd ?? 0) + (feesUsd ?? 0),
      notes,
    })
    .eq("id", positionAddress);

  if (error) throw error;
}

export async function recordClose(positionAddress: string, reason: string) {
  const pos = await getPosition(positionAddress);
  if (!pos) return;

  const notes = Array.isArray(pos.notes) ? [...pos.notes] : [];
  const now = new Date().toISOString();
  notes.push(`Closed at ${now}: ${reason}`);

  const { error } = await supabase
    .from("positions")
    .update({ closed: true, closed_at: now, notes })
    .eq("id", positionAddress);

  if (error) throw error;
  await pushEvent({
    action: "close",
    position: positionAddress,
    poolName: pos.pool_name ?? pos.pool,
    reason,
  });
  log("state", `Position ${positionAddress} marked closed: ${reason}`);
}

export async function recordRebalance(
  oldPosition: string,
  newPosition: string,
) {
  const now = new Date().toISOString();
  const old = await getPosition(oldPosition);

  if (old) {
    const notes = Array.isArray(old.notes) ? [...old.notes] : [];
    notes.push(`Rebalanced into ${newPosition} at ${now}`);
    const { error } = await supabase
      .from("positions")
      .update({ closed: true, closed_at: now, notes })
      .eq("id", oldPosition);
    if (error) throw error;
  }

  const newPos = await getPosition(newPosition);
  if (newPos) {
    const notes = Array.isArray(newPos.notes) ? [...newPos.notes] : [];
    notes.push(`Rebalanced from ${oldPosition}`);
    const { error } = await supabase
      .from("positions")
      .update({ rebalance_count: (old?.rebalance_count ?? 0) + 1, notes })
      .eq("id", newPosition);
    if (error) throw error;
  }
}

export async function setPositionInstruction(
  positionAddress: string,
  instruction: string | null,
): Promise<boolean> {
  const pos = await getPosition(positionAddress);
  if (!pos) return false;

  const { error } = await supabase
    .from("positions")
    .update({ instruction: instruction ?? null })
    .eq("id", positionAddress);

  if (error) throw error;
  log("state", `Position ${positionAddress} instruction set: ${instruction}`);
  return true;
}

export async function getTrackedPositions(openOnly = false) {
  let query = supabase
    .from("positions")
    .select("*")
    .order("deployed_at", { ascending: false });
  if (openOnly) query = query.eq("closed", false);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getTrackedPosition(positionAddress: string) {
  return getPosition(positionAddress);
}

export async function getStateSummary() {
  const { data: positionsData, error: positionsError } = await supabase
    .from("positions")
    .select("*");
  if (positionsError) throw positionsError;
  const positions = positionsData ?? [];

  const { data: eventsData, error: eventsError } = await supabase
    .from("recent_events")
    .select("*")
    .order("ts", { ascending: false })
    .limit(10);
  if (eventsError) throw eventsError;
  const events = eventsData ?? [];

  const open = positions.filter((position: any) => !position.closed);
  const closedCount = positions.filter(
    (position: any) => position.closed,
  ).length;
  const totalFees = positions.reduce(
    (sum: number, position: any) =>
      sum + (position.total_fees_claimed_usd ?? 0),
    0,
  );

  return {
    open_positions: open.length,
    closed_positions: closedCount,
    total_fees_claimed_usd: Math.round(totalFees * 100) / 100,
    positions: await Promise.all(
      open.map(async (position: any) => ({
        position: position.id,
        pool: position.pool,
        strategy: position.strategy,
        deployed_at: position.deployed_at
          ? new Date(position.deployed_at).toISOString()
          : null,
        out_of_range_since: position.out_of_range_since
          ? new Date(position.out_of_range_since).toISOString()
          : null,
        minutes_out_of_range: await minutesOutOfRange(position.id),
        total_fees_claimed_usd: position.total_fees_claimed_usd,
        initial_fee_tvl_24h: position.initial_fee_tvl_24h,
        rebalance_count: position.rebalance_count,
        instruction: position.instruction ?? null,
      })),
    ),
    last_updated: new Date().toISOString(),
    recent_events: events.map((event: any) => ({
      ts: new Date(event.ts).toISOString(),
      action: event.action,
      position: event.position,
      pool_name: event.pool_name,
      reason: event.reason,
    })),
  };
}

export async function getLastBriefingDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", "lastBriefingDate")
    .maybeSingle();

  if (error) throw error;
  return data?.value ?? null;
}

export async function setLastBriefingDate() {
  const value = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("app_state")
    .upsert({ key: "lastBriefingDate", value }, { onConflict: "key" });

  if (error) throw error;
}

export async function syncOpenPositions(activeAddresses: string[]) {
  const graceMs = 5 * 60_000;
  const activeSet = new Set(activeAddresses);
  const { data: openPositionsData, error } = await supabase
    .from("positions")
    .select("*")
    .eq("closed", false);
  if (error) throw error;
  const openPositions = openPositionsData ?? [];

  for (const position of openPositions) {
    if (activeSet.has(position.id)) continue;
    const deployedAt = new Date(position.deployed_at).getTime();
    if (Date.now() - deployedAt < graceMs) continue;

    const notes = Array.isArray(position.notes) ? [...position.notes] : [];
    notes.push("Auto-closed during state sync (not found on-chain)");

    const { error: updateError } = await supabase
      .from("positions")
      .update({ closed: true, closed_at: new Date().toISOString(), notes })
      .eq("id", position.id);

    if (updateError) throw updateError;
    log(
      "state",
      `Position ${position.id} auto-closed (missing from on-chain data)`,
    );
  }
}

async function pushEvent(event: {
  action: string;
  position?: string;
  poolName?: string;
  reason?: string;
}) {
  const { error } = await supabase.from("recent_events").insert({
    action: event.action,
    position: event.position ?? null,
    pool_name: event.poolName ?? null,
    reason: event.reason ?? null,
  });

  if (error) throw error;

  const { count, error: countError } = await supabase
    .from("recent_events")
    .select("id", { count: "exact", head: true });

  if (countError) throw countError;
  if ((count ?? 0) > MAX_RECENT_EVENTS) {
    const { data: oldData, error: oldError } = await supabase
      .from("recent_events")
      .select("id")
      .order("ts", { ascending: true })
      .limit((count ?? 0) - MAX_RECENT_EVENTS);
    if (oldError) throw oldError;
    const old = oldData ?? [];

    if (old.length > 0) {
      const { error: deleteError } = await supabase
        .from("recent_events")
        .delete()
        .in(
          "id",
          old.map((eventRow: { id: number }) => eventRow.id),
        );
      if (deleteError) throw deleteError;
    }
  }
}
