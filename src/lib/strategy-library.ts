import { supabase } from "./db";
import { log } from "./logger";

const DEFAULT_STRATEGIES: Record<
  string,
  {
    id: string;
    name: string;
    author: string;
    lpStrategy: string;
    data: Record<string, unknown>;
  }
> = {
  custom_ratio_spot: {
    id: "custom_ratio_spot",
    name: "Custom Ratio Spot",
    author: "meridian",
    lpStrategy: "spot",
    data: {
      token_criteria: { notes: "Any token. Ratio expresses directional bias." },
      entry: {
        condition: "Directional view on token",
        single_side: null,
        notes: "75% token = bullish. 75% SOL = bearish/DCA-in.",
      },
      range: {
        type: "custom",
        notes: "bins_below:bins_above ratio matches token:SOL ratio.",
      },
      exit: { take_profit_pct: 10, notes: "Close when OOR or TP hit." },
      best_for: "Expressing directional bias while earning fees both ways",
    },
  },
  single_sided_reseed: {
    id: "single_sided_reseed",
    name: "Single-Sided Bid-Ask + Re-seed",
    author: "meridian",
    lpStrategy: "bid_ask",
    data: {
      token_criteria: { notes: "Volatile tokens with strong narrative." },
      entry: {
        condition: "Deploy token-only bid-ask, bins below active bin only",
        single_side: "token",
      },
      range: {
        type: "default",
        bins_below_pct: 100,
        notes: "All bins below active bin. bins_above=0.",
      },
      exit: {
        notes: "When OOR downside: close_position(skip_swap=true) → redeploy.",
      },
      best_for: "Riding volatile tokens down without cutting losses",
    },
  },
  fee_compounding: {
    id: "fee_compounding",
    name: "Fee Compounding",
    author: "meridian",
    lpStrategy: "any",
    data: {
      token_criteria: {
        notes: "Stable volume pools with consistent fee generation.",
      },
      entry: { condition: "Deploy normally with any shape" },
      range: { type: "default" },
      exit: {
        notes:
          "When unclaimed fees > $5 AND in range: claim_fees → add_liquidity.",
      },
      best_for: "Maximizing yield on stable pools via compounding",
    },
  },
  multi_layer: {
    id: "multi_layer",
    name: "Multi-Layer",
    author: "meridian",
    lpStrategy: "mixed",
    data: {
      token_criteria: {
        notes: "High volume pools. Layer multiple shapes into ONE position.",
      },
      entry: {
        condition:
          "Create ONE position, then layer additional shapes with add-liquidity.",
      },
      range: { type: "custom" },
      exit: { notes: "Single position — one close, one claim." },
      best_for: "Creating custom liquidity distributions by stacking shapes",
    },
  },
  partial_harvest: {
    id: "partial_harvest",
    name: "Partial Harvest",
    author: "meridian",
    lpStrategy: "any",
    data: {
      token_criteria: { notes: "High fee pools." },
      entry: { condition: "Deploy normally" },
      range: { type: "default" },
      exit: {
        take_profit_pct: 10,
        notes: "When total return >= 10%: withdraw_liquidity(bps=5000).",
      },
      best_for: "Locking in profits without fully exiting",
    },
  },
};

export async function ensureDefaultStrategies() {
  for (const [id, strategy] of Object.entries(DEFAULT_STRATEGIES)) {
    const { data: existing, error } = await supabase
      .from("strategies")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!existing) {
      const { error: insertError } = await supabase.from("strategies").insert({
        id,
        name: strategy.name,
        author: strategy.author,
        lp_strategy: strategy.lpStrategy,
        data: strategy.data,
        active: id === "custom_ratio_spot",
      });
      if (insertError) throw insertError;
    }
  }
}

export async function addStrategy(params: {
  id: string;
  name: string;
  author?: string;
  lp_strategy?: string;
  [key: string]: unknown;
}) {
  if (!params.id || !params.name) return { error: "id and name are required" };
  const slug = params.id
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  const { id: _, name, author, lp_strategy, ...rest } = params;
  const { error } = await supabase.from("strategies").upsert(
    {
      id: slug,
      name,
      author: author ?? "unknown",
      lp_strategy: lp_strategy ?? "bid_ask",
      data: rest as object,
    },
    { onConflict: "id" },
  );

  if (error) throw error;

  const { count, error: countError } = await supabase
    .from("strategies")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  if ((count ?? 0) === 1) {
    const { error: activateError } = await supabase
      .from("strategies")
      .update({ active: true })
      .eq("id", slug);
    if (activateError) throw activateError;
  }

  log("strategy", `Strategy saved: ${name} (${slug})`);
  const { data: saved, error: savedError } = await supabase
    .from("strategies")
    .select("active")
    .eq("id", slug)
    .maybeSingle();
  if (savedError) throw savedError;

  return { saved: true, id: slug, name, active: saved?.active ?? false };
}

export async function listStrategies() {
  const { data: allData, error } = await supabase
    .from("strategies")
    .select("*");
  if (error) throw error;
  const all = allData ?? [];

  return {
    active: all.find((strategy: any) => strategy.active)?.id ?? null,
    count: all.length,
    strategies: all.map((strategy: any) => ({
      id: strategy.id,
      name: strategy.name,
      author: strategy.author,
      lp_strategy: strategy.lp_strategy,
      best_for: (strategy.data as Record<string, unknown>)?.best_for ?? "",
      active: strategy.active,
    })),
  };
}

export async function getStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!strategy) {
    const { data: availableData } = await supabase
      .from("strategies")
      .select("id");
    const available = availableData ?? [];
    return {
      error: `Strategy "${id}" not found`,
      available: available.map((entry: any) => entry.id),
    };
  }
  return {
    id: strategy.id,
    name: strategy.name,
    author: strategy.author,
    lp_strategy: strategy.lp_strategy,
    ...(strategy.data as object),
    is_active: strategy.active,
  };
}

export async function setActiveStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!strategy) return { error: `Strategy "${id}" not found` };

  const { error: deactivateError } = await supabase
    .from("strategies")
    .update({ active: false });
  if (deactivateError) throw deactivateError;

  const { error: activateError } = await supabase
    .from("strategies")
    .update({ active: true })
    .eq("id", id);
  if (activateError) throw activateError;

  log("strategy", `Active strategy set to: ${strategy.name}`);
  return { active: id, name: strategy.name };
}

export async function removeStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!strategy) return { error: `Strategy "${id}" not found` };

  const { error: deleteError } = await supabase
    .from("strategies")
    .delete()
    .eq("id", id);
  if (deleteError) throw deleteError;

  if (strategy.active) {
    const { data: first } = await supabase
      .from("strategies")
      .select("id")
      .maybeSingle();
    if (first?.id) {
      await supabase
        .from("strategies")
        .update({ active: true })
        .eq("id", first.id);
    }
  }

  log("strategy", `Strategy removed: ${strategy.name}`);
  return { removed: true, id, name: strategy.name };
}

export async function getActiveStrategy() {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
