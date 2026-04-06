import { prisma } from "./db";
import { log } from "./logger";

export interface MeridianConfig {
  risk: {
    maxPositions: number;
    maxDeployAmount: number;
  };
  screening: {
    minFeeActiveTvlRatio: number;
    minTvl: number;
    maxTvl: number;
    minVolume: number;
    minOrganic: number;
    minHolders: number;
    minMcap: number;
    maxMcap: number;
    minBinStep: number;
    maxBinStep: number;
    timeframe: string;
    category: string;
    minTokenFeesSol: number;
    maxBundlersPct: number;
    maxTop10Pct: number;
    blockedLaunchpads: string[];
  };
  management: {
    minClaimAmount: number;
    autoSwapAfterClaim: boolean;
    outOfRangeBinsToClose: number;
    outOfRangeWaitMinutes: number;
    minVolumeToRebalance: number;
    emergencyPriceDropPct: number;
    takeProfitFeePct: number;
    minFeePerTvl24h: number;
    minSolToOpen: number;
    deployAmountSol: number;
    gasReserve: number;
    positionSizePct: number;
  };
  strategy: {
    strategy: string;
    binsBelow: number;
  };
  schedule: {
    managementIntervalMin: number;
    screeningIntervalMin: number;
    healthCheckIntervalMin: number;
  };
  llm: {
    temperature: number;
    maxTokens: number;
    maxSteps: number;
    managementModel: string;
    screeningModel: string;
    generalModel: string;
  };
  tokens: {
    SOL: string;
    USDC: string;
    USDT: string;
  };
}

const DEFAULT_CONFIG: MeridianConfig = {
  risk: { maxPositions: 3, maxDeployAmount: 50 },
  screening: {
    minFeeActiveTvlRatio: 0.05,
    minTvl: 10_000,
    maxTvl: 150_000,
    minVolume: 500,
    minOrganic: 60,
    minHolders: 500,
    minMcap: 150_000,
    maxMcap: 10_000_000,
    minBinStep: 80,
    maxBinStep: 125,
    timeframe: "5m",
    category: "trending",
    minTokenFeesSol: 30,
    maxBundlersPct: 30,
    maxTop10Pct: 60,
    blockedLaunchpads: [],
  },
  management: {
    minClaimAmount: 5,
    autoSwapAfterClaim: false,
    outOfRangeBinsToClose: 10,
    outOfRangeWaitMinutes: 30,
    minVolumeToRebalance: 1000,
    emergencyPriceDropPct: -50,
    takeProfitFeePct: 5,
    minFeePerTvl24h: 7,
    minSolToOpen: 0.55,
    deployAmountSol: 0.5,
    gasReserve: 0.2,
    positionSizePct: 0.35,
  },
  strategy: { strategy: "bid_ask", binsBelow: 69 },
  schedule: {
    managementIntervalMin: 10,
    screeningIntervalMin: 30,
    healthCheckIntervalMin: 60,
  },
  llm: {
    temperature: 0.373,
    maxTokens: 4096,
    maxSteps: 20,
    managementModel: process.env.LLM_MODEL ?? "openrouter/healer-alpha",
    screeningModel: process.env.LLM_MODEL ?? "openrouter/hunter-alpha",
    generalModel: process.env.LLM_MODEL ?? "openrouter/healer-alpha",
  },
  tokens: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
};

// In-memory config, loaded from DB at startup
export let config: MeridianConfig = structuredClone(DEFAULT_CONFIG);

export async function loadConfig(): Promise<MeridianConfig> {
  try {
    const row = await prisma.config.findUnique({ where: { id: 1 } });
    if (row?.data) {
      const saved = row.data as Record<string, unknown>;
      config = deepMerge(DEFAULT_CONFIG, saved) as MeridianConfig;
    }
  } catch {
    log("config", "No config in DB, using defaults");
  }
  return config;
}

export async function saveConfig(partial: Record<string, unknown>) {
  const current = await prisma.config.findUnique({ where: { id: 1 } });
  const existing = (current?.data as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...partial };
  await prisma.config.upsert({
    where: { id: 1 },
    update: { data: merged as object },
    create: { id: 1, data: merged as object },
  });
}

export function computeDeployAmount(walletSol: number): number {
  const reserve = config.management.gasReserve;
  const pct = config.management.positionSizePct;
  const floor = config.management.deployAmountSol;
  const ceil = config.risk.maxDeployAmount;
  const deployable = Math.max(0, walletSol - reserve);
  const dynamic = deployable * pct;
  return parseFloat(Math.min(ceil, Math.max(floor, dynamic)).toFixed(2));
}

export async function reloadScreeningThresholds() {
  await loadConfig();
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!source || typeof source !== "object") return target;
  if (!target || typeof target !== "object") return source;

  const result = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sv = (source as Record<string, unknown>)[key];
    const tv = result[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
