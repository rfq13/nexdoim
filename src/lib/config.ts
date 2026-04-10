import { supabase } from "./db";
import { log } from "./logger";

export interface MeridianConfig {
  risk: {
    maxPositions: number;
    maxDeployAmount: number;
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
  darwin: {
    enabled: boolean;
    windowDays: number;
    minSamples: number;
    boostFactor: number;
    decayFactor: number;
    weightFloor: number;
    weightCeiling: number;
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
    avoidPvpSymbols: boolean;
    blockPvpSymbols: boolean;
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
    avoidPvpSymbols: true,
    blockPvpSymbols: false,
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
    managementModel:
      process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL ?? "gpt-oss:120b",
    screeningModel:
      process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL ?? "gpt-oss:120b",
    generalModel:
      process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL ?? "gpt-oss:120b",
  },
  tokens: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  darwin: {
    enabled: true,
    windowDays: 60,
    minSamples: 10,
    boostFactor: 1.05,
    decayFactor: 0.95,
    weightFloor: 0.3,
    weightCeiling: 2.5,
  },
};

export let config: MeridianConfig = structuredClone(DEFAULT_CONFIG);

export async function getSecret(key: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from("secrets")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    return data?.value ?? process.env[key];
  } catch (e: any) {
    if (process.env.SUPABASE_URL) {
      log("config_error", `Failed to fetch secret ${key}: ${e?.message || JSON.stringify(e)}`);
    }
    return process.env[key];
  }
}

export async function loadConfig(): Promise<MeridianConfig> {
  try {
    const { data, error } = await supabase
      .from("config")
      .select("data")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;
    if (data?.data) {
      config = deepMerge(
        DEFAULT_CONFIG,
        data.data as Record<string, unknown>,
      ) as MeridianConfig;
    }
  } catch {
    log("config", "No config in DB, using defaults");
  }
  return config;
}

export async function saveConfig(partial: Record<string, unknown>) {
  const { data: current, error: currentError } = await supabase
    .from("config")
    .select("data")
    .eq("id", 1)
    .maybeSingle();

  if (currentError) throw currentError;

  const existing = (current?.data as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...partial };

  const { error } = await supabase
    .from("config")
    .upsert({ id: 1, data: merged }, { onConflict: "id" });

  if (error) throw error;
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

export function computeBinRange(
  volatility: number,
  binStep: number,
): { binsBelow: number; binsAbove: number } {
  const baseBins = config.strategy.binsBelow;

  if (volatility >= 8) {
    return { binsBelow: Math.min(baseBins * 2, 138), binsAbove: 0 };
  } else if (volatility >= 5) {
    return {
      binsBelow: Math.min(Math.round(baseBins * 1.5), 100),
      binsAbove: 0,
    };
  } else if (volatility >= 2) {
    return { binsBelow: baseBins, binsAbove: 0 };
  } else {
    return {
      binsBelow: Math.max(Math.round(baseBins * 0.6), 20),
      binsAbove: 0,
    };
  }
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
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
