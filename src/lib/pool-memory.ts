import { supabase } from "./db";
import { log } from "./logger";

export async function recordPoolDeploy(
  poolAddress: string,
  deployData: {
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
  },
) {
  if (!poolAddress) return;

  const { data: existing, error } = await supabase
    .from("pool_memory")
    .select("*")
    .eq("pool_address", poolAddress)
    .maybeSingle();

  if (error) throw error;

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
    const { error: insertError } = await supabase.from("pool_memory").insert({
      pool_address: poolAddress,
      name: deployData.pool_name ?? poolAddress.slice(0, 8),
      base_mint: deployData.base_mint ?? null,
      deploys: [deploy],
      total_deploys: 1,
      avg_pnl_pct: deploy.pnl_pct ?? 0,
      win_rate: (deploy.pnl_pct ?? 0) >= 0 ? 1 : 0,
      last_deployed_at: new Date().toISOString(),
      last_outcome: (deploy.pnl_pct ?? 0) >= 0 ? "profit" : "loss",
      snapshots: [],
      notes: [],
    });

    if (insertError) throw insertError;
  } else {
    const deploys = Array.isArray(existing.deploys)
      ? [...existing.deploys, deploy]
      : [deploy];
    const withPnl = deploys.filter(
      (entry: any) => entry.pnl_pct != null,
    ) as Array<{ pnl_pct: number }>;
    const avgPnl =
      withPnl.length > 0
        ? Math.round(
            (withPnl.reduce((sum, entry) => sum + entry.pnl_pct, 0) /
              withPnl.length) *
              100,
          ) / 100
        : 0;
    const winRate =
      withPnl.length > 0
        ? Math.round(
            (withPnl.filter((entry) => entry.pnl_pct >= 0).length /
              withPnl.length) *
              100,
          ) / 100
        : 0;

    const { error: updateError } = await supabase
      .from("pool_memory")
      .update({
        deploys,
        total_deploys: deploys.length,
        avg_pnl_pct: avgPnl,
        win_rate: winRate,
        last_deployed_at: new Date().toISOString(),
        last_outcome: (deploy.pnl_pct ?? 0) >= 0 ? "profit" : "loss",
        base_mint: deployData.base_mint ?? existing.base_mint ?? null,
      })
      .eq("pool_address", poolAddress);

    if (updateError) throw updateError;
  }

  log(
    "pool-memory",
    `Recorded deploy for ${deployData.pool_name ?? poolAddress.slice(0, 8)}: PnL ${deploy.pnl_pct}%`,
  );
}

export async function getPoolMemory({
  pool_address,
}: {
  pool_address: string;
}) {
  if (!pool_address) return { error: "pool_address required" };

  const { data: entry, error } = await supabase
    .from("pool_memory")
    .select("*")
    .eq("pool_address", pool_address)
    .maybeSingle();

  if (error) throw error;
  if (!entry) {
    return {
      pool_address,
      known: false,
      message: "No history for this pool — first time deploying here.",
    };
  }

  return {
    pool_address,
    known: true,
    name: entry.name,
    base_mint: entry.base_mint,
    total_deploys: entry.total_deploys,
    avg_pnl_pct: entry.avg_pnl_pct,
    win_rate: entry.win_rate,
    last_deployed_at: entry.last_deployed_at
      ? new Date(entry.last_deployed_at).toISOString()
      : null,
    last_outcome: entry.last_outcome,
    notes: entry.notes ?? [],
    history: (entry.deploys ?? []).slice(-10),
  };
}

export async function recordPositionSnapshot(
  poolAddress: string,
  snapshot: Record<string, unknown>,
) {
  if (!poolAddress) return;

  const { data: entry, error } = await supabase
    .from("pool_memory")
    .select("*")
    .eq("pool_address", poolAddress)
    .maybeSingle();

  if (error) throw error;

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
    const { error: insertError } = await supabase.from("pool_memory").insert({
      pool_address: poolAddress,
      name: (snapshot.pair as string) ?? poolAddress.slice(0, 8),
      snapshots: [snap],
      deploys: [],
      notes: [],
      total_deploys: 0,
      avg_pnl_pct: 0,
      win_rate: 0,
      last_outcome: null,
    });

    if (insertError) throw insertError;
  } else {
    const snapshots = Array.isArray(entry.snapshots)
      ? [...entry.snapshots, snap].slice(-48)
      : [snap];
    const { error: updateError } = await supabase
      .from("pool_memory")
      .update({ snapshots })
      .eq("pool_address", poolAddress);

    if (updateError) throw updateError;
  }
}

export async function recallForPool(
  poolAddress: string,
): Promise<string | null> {
  if (!poolAddress) return null;
  const { data: entry, error } = await supabase
    .from("pool_memory")
    .select("*")
    .eq("pool_address", poolAddress)
    .maybeSingle();

  if (error) throw error;
  if (!entry) return null;

  const lines: string[] = [];

  if ((entry.total_deploys ?? 0) > 0) {
    lines.push(
      `POOL MEMORY [${entry.name}]: ${entry.total_deploys} past deploy(s), avg PnL ${entry.avg_pnl_pct}%, win rate ${entry.win_rate}%, last outcome: ${entry.last_outcome}`,
    );
  }

  const snaps = (
    (entry.snapshots ?? []) as Array<{ pnl_pct?: number; in_range?: boolean }>
  ).slice(-6);
  if (snaps.length >= 2) {
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const pnlTrend =
      last.pnl_pct != null && first.pnl_pct != null
        ? (last.pnl_pct - first.pnl_pct).toFixed(2)
        : null;
    const oorCount = snaps.filter((snap) => snap.in_range === false).length;
    lines.push(
      `RECENT TREND: PnL drift ${pnlTrend !== null ? (Number(pnlTrend) >= 0 ? "+" : "") + pnlTrend + "%" : "unknown"} over last ${snaps.length} cycles, OOR in ${oorCount}/${snaps.length} cycles`,
    );
  }

  const notes = (entry.notes ?? []) as Array<{ note: string }>;
  if (notes.length > 0) {
    lines.push(`NOTE: ${notes[notes.length - 1].note}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export async function addPoolNote({
  pool_address,
  note,
}: {
  pool_address: string;
  note: string;
}) {
  if (!pool_address) return { error: "pool_address required" };
  if (!note) return { error: "note required" };

  const { data: entry, error } = await supabase
    .from("pool_memory")
    .select("*")
    .eq("pool_address", pool_address)
    .maybeSingle();

  if (error) throw error;

  const noteEntry = { note, added_at: new Date().toISOString() };
  if (!entry) {
    const { error: insertError } = await supabase.from("pool_memory").insert({
      pool_address,
      name: pool_address.slice(0, 8),
      notes: [noteEntry],
      deploys: [],
      snapshots: [],
      total_deploys: 0,
      avg_pnl_pct: 0,
      win_rate: 0,
      last_outcome: null,
    });

    if (insertError) throw insertError;
  } else {
    const notes = Array.isArray(entry.notes)
      ? [...entry.notes, noteEntry]
      : [noteEntry];
    const { error: updateError } = await supabase
      .from("pool_memory")
      .update({ notes })
      .eq("pool_address", pool_address);

    if (updateError) throw updateError;
  }

  log("pool-memory", `Note added to ${pool_address.slice(0, 8)}: ${note}`);
  return { saved: true, pool_address, note };
}
