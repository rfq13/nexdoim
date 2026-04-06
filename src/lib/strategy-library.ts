import { prisma } from "./db";
import { log } from "./logger";

const DEFAULT_STRATEGIES: Record<string, { id: string; name: string; author: string; lpStrategy: string; data: Record<string, unknown> }> = {
  custom_ratio_spot: {
    id: "custom_ratio_spot",
    name: "Custom Ratio Spot",
    author: "meridian",
    lpStrategy: "spot",
    data: {
      token_criteria: { notes: "Any token. Ratio expresses directional bias." },
      entry: { condition: "Directional view on token", single_side: null, notes: "75% token = bullish. 75% SOL = bearish/DCA-in." },
      range: { type: "custom", notes: "bins_below:bins_above ratio matches token:SOL ratio." },
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
      entry: { condition: "Deploy token-only bid-ask, bins below active bin only", single_side: "token" },
      range: { type: "default", bins_below_pct: 100, notes: "All bins below active bin. bins_above=0." },
      exit: { notes: "When OOR downside: close_position(skip_swap=true) → redeploy." },
      best_for: "Riding volatile tokens down without cutting losses",
    },
  },
  fee_compounding: {
    id: "fee_compounding",
    name: "Fee Compounding",
    author: "meridian",
    lpStrategy: "any",
    data: {
      token_criteria: { notes: "Stable volume pools with consistent fee generation." },
      entry: { condition: "Deploy normally with any shape" },
      range: { type: "default" },
      exit: { notes: "When unclaimed fees > $5 AND in range: claim_fees → add_liquidity." },
      best_for: "Maximizing yield on stable pools via compounding",
    },
  },
  multi_layer: {
    id: "multi_layer",
    name: "Multi-Layer",
    author: "meridian",
    lpStrategy: "mixed",
    data: {
      token_criteria: { notes: "High volume pools. Layer multiple shapes into ONE position." },
      entry: { condition: "Create ONE position, then layer additional shapes with add-liquidity." },
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
      exit: { take_profit_pct: 10, notes: "When total return >= 10%: withdraw_liquidity(bps=5000)." },
      best_for: "Locking in profits without fully exiting",
    },
  },
};

export async function ensureDefaultStrategies() {
  for (const [id, s] of Object.entries(DEFAULT_STRATEGIES)) {
    const existing = await prisma.strategy.findUnique({ where: { id } });
    if (!existing) {
      await prisma.strategy.create({
        data: { id, name: s.name, author: s.author, lpStrategy: s.lpStrategy, data: s.data, active: id === "custom_ratio_spot" },
      });
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
  const slug = params.id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  const { id: _, name, author, lp_strategy, ...rest } = params;
  await prisma.strategy.upsert({
    where: { id: slug },
    update: { name, author: author ?? "unknown", lpStrategy: lp_strategy ?? "bid_ask", data: rest as object },
    create: { id: slug, name, author: author ?? "unknown", lpStrategy: lp_strategy ?? "bid_ask", data: rest as object },
  });

  // Auto-activate if first
  const count = await prisma.strategy.count();
  if (count === 1) {
    await prisma.strategy.update({ where: { id: slug }, data: { active: true } });
  }

  log("strategy", `Strategy saved: ${name} (${slug})`);
  const isActive = (await prisma.strategy.findUnique({ where: { id: slug } }))?.active;
  return { saved: true, id: slug, name, active: isActive };
}

export async function listStrategies() {
  const all = await prisma.strategy.findMany();
  return {
    active: all.find((s) => s.active)?.id ?? null,
    count: all.length,
    strategies: all.map((s) => ({
      id: s.id, name: s.name, author: s.author, lp_strategy: s.lpStrategy,
      best_for: (s.data as Record<string, unknown>)?.best_for ?? "",
      active: s.active,
    })),
  };
}

export async function getStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const s = await prisma.strategy.findUnique({ where: { id } });
  if (!s) {
    const all = await prisma.strategy.findMany({ select: { id: true } });
    return { error: `Strategy "${id}" not found`, available: all.map((a) => a.id) };
  }
  return { id: s.id, name: s.name, author: s.author, lp_strategy: s.lpStrategy, ...(s.data as object), is_active: s.active };
}

export async function setActiveStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const s = await prisma.strategy.findUnique({ where: { id } });
  if (!s) return { error: `Strategy "${id}" not found` };

  await prisma.strategy.updateMany({ data: { active: false } });
  await prisma.strategy.update({ where: { id }, data: { active: true } });
  log("strategy", `Active strategy set to: ${s.name}`);
  return { active: id, name: s.name };
}

export async function removeStrategy({ id }: { id: string }) {
  if (!id) return { error: "id required" };
  const s = await prisma.strategy.findUnique({ where: { id } });
  if (!s) return { error: `Strategy "${id}" not found` };

  await prisma.strategy.delete({ where: { id } });
  if (s.active) {
    const first = await prisma.strategy.findFirst();
    if (first) await prisma.strategy.update({ where: { id: first.id }, data: { active: true } });
  }
  log("strategy", `Strategy removed: ${s.name}`);
  return { removed: true, id, name: s.name };
}

export async function getActiveStrategy() {
  return prisma.strategy.findFirst({ where: { active: true } });
}
