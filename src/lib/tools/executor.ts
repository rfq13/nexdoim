import { discoverPools, getPoolDetail, getTopCandidates } from "./screening";
import { getActiveBin, deployPosition, getMyPositions, getWalletPositions, getPositionPnl, claimFees, closePosition, searchPools, withdrawLiquidity, addLiquidity } from "./dlmm";
import { getWalletBalances, swapToken } from "./wallet";
import { studyTopLPers } from "./study";
import { addLesson, clearAllLessons, clearPerformance, removeLessonsByKeyword, getPerformanceHistory, pinLesson, unpinLesson, listLessons } from "../lessons";
import { setPositionInstruction } from "../state";
import { getPoolMemory, addPoolNote } from "../pool-memory";
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy } from "../strategy-library";
import { addToBlacklist, removeFromBlacklist, listBlacklist } from "../token-blacklist";
import { addSmartWallet, removeSmartWallet, listSmartWallets, checkSmartWalletsOnPool } from "../smart-wallets";
import { getTokenInfo, getTokenHolders, getTokenNarrative } from "./token";
import { config, saveConfig } from "../config";
import { log, logAction } from "../logger";
import { notifyDeploy, notifyClose, notifySwap } from "../telegram";
import { appendDecision, getRecentDecisions } from "../decision-log";
import { blockDev, unblockDev, listBlockedDevs } from "../dev-blocklist";
import { listGoals, getGoal, createGoal, updateGoal, deleteGoal, syncGoalProgress, analyzeStrategy } from "../goals";

let _cronRestarter: (() => void) | null = null;
export function registerCronRestarter(fn: () => void) { _cronRestarter = fn; }

const CONFIG_MAP: Record<string, [string, string]> = {
  minFeeActiveTvlRatio: ["screening", "minFeeActiveTvlRatio"], minTvl: ["screening", "minTvl"],
  maxTvl: ["screening", "maxTvl"], minVolume: ["screening", "minVolume"], minOrganic: ["screening", "minOrganic"],
  minHolders: ["screening", "minHolders"], minMcap: ["screening", "minMcap"], maxMcap: ["screening", "maxMcap"],
  minBinStep: ["screening", "minBinStep"], maxBinStep: ["screening", "maxBinStep"],
  timeframe: ["screening", "timeframe"], category: ["screening", "category"], minTokenFeesSol: ["screening", "minTokenFeesSol"],
  maxBundlersPct: ["screening", "maxBundlersPct"], maxTop10Pct: ["screening", "maxTop10Pct"],
  minFeePerTvl24h: ["management", "minFeePerTvl24h"], minClaimAmount: ["management", "minClaimAmount"],
  autoSwapAfterClaim: ["management", "autoSwapAfterClaim"], outOfRangeBinsToClose: ["management", "outOfRangeBinsToClose"],
  outOfRangeWaitMinutes: ["management", "outOfRangeWaitMinutes"], minVolumeToRebalance: ["management", "minVolumeToRebalance"],
  emergencyPriceDropPct: ["management", "emergencyPriceDropPct"], takeProfitFeePct: ["management", "takeProfitFeePct"],
  minSolToOpen: ["management", "minSolToOpen"], deployAmountSol: ["management", "deployAmountSol"],
  gasReserve: ["management", "gasReserve"], positionSizePct: ["management", "positionSizePct"],
  maxPositions: ["risk", "maxPositions"], maxDeployAmount: ["risk", "maxDeployAmount"],
  managementIntervalMin: ["schedule", "managementIntervalMin"], screeningIntervalMin: ["schedule", "screeningIntervalMin"],
  managementModel: ["llm", "managementModel"], screeningModel: ["llm", "screeningModel"], generalModel: ["llm", "generalModel"],
  binsBelow: ["strategy", "binsBelow"],
  avoidPvpSymbols: ["screening", "avoidPvpSymbols"], blockPvpSymbols: ["screening", "blockPvpSymbols"],
  darwinEnabled: ["darwin", "enabled"], darwinWindowDays: ["darwin", "windowDays"],
  darwinBoostFactor: ["darwin", "boostFactor"], darwinDecayFactor: ["darwin", "decayFactor"],
  darwinWeightFloor: ["darwin", "weightFloor"], darwinWeightCeiling: ["darwin", "weightCeiling"],
};

const toolMap: Record<string, (args: any) => any> = {
  discover_pools: discoverPools,
  get_top_candidates: getTopCandidates,
  get_pool_detail: getPoolDetail,
  get_position_pnl: getPositionPnl,
  get_active_bin: getActiveBin,
  deploy_position: deployPosition,
  get_my_positions: getMyPositions,
  get_wallet_positions: getWalletPositions,
  search_pools: searchPools,
  get_token_info: getTokenInfo,
  get_token_holders: getTokenHolders,
  get_token_narrative: getTokenNarrative,
  add_smart_wallet: addSmartWallet,
  remove_smart_wallet: removeSmartWallet,
  list_smart_wallets: listSmartWallets,
  check_smart_wallets_on_pool: checkSmartWalletsOnPool,
  claim_fees: claimFees,
  close_position: closePosition,
  get_wallet_balance: getWalletBalances,
  swap_token: swapToken,
  get_top_lpers: studyTopLPers,
  study_top_lpers: studyTopLPers,
  set_position_note: async ({ position_address, instruction }: any) => {
    const ok = await setPositionInstruction(position_address, instruction || null);
    if (!ok) return { error: `Position ${position_address} not found` };
    return { saved: true, position: position_address, instruction: instruction || null };
  },
  get_performance_history: getPerformanceHistory,
  add_strategy: addStrategy,
  list_strategies: listStrategies,
  get_strategy: getStrategy,
  set_active_strategy: setActiveStrategy,
  remove_strategy: removeStrategy,
  get_pool_memory: getPoolMemory,
  add_pool_note: addPoolNote,
  withdraw_liquidity: withdrawLiquidity,
  add_liquidity: addLiquidity,
  add_to_blacklist: addToBlacklist,
  remove_from_blacklist: removeFromBlacklist,
  list_blacklist: listBlacklist,
  block_deployer: blockDev,
  unblock_deployer: unblockDev,
  list_blocked_deployers: listBlockedDevs,
  get_recent_decisions: async ({ limit }: any) => ({ decisions: await getRecentDecisions(limit ?? 6) }),
  list_goals: async ({ status }: any) => {
    const goals = await listGoals(status);
    return { count: goals.length, goals: goals.map((g) => ({ id: g.id, title: g.title, target_pnl: g.target_pnl, current_pnl: g.current_pnl, status: g.status, start_date: g.start_date, end_date: g.end_date })) };
  },
  get_goal_progress: async ({ id }: any) => {
    const goal = await getGoal(id);
    if (!goal) return { error: `Goal ${id} not found` };
    const progress = await syncGoalProgress(goal);
    const strategy = analyzeStrategy(progress);
    return { ...progress, proposed_adjustments: strategy };
  },
  create_goal: async ({ title, target_pnl, end_date, start_date, notes }: any) => {
    const goal = await createGoal({ title, target_pnl, end_date, start_date, notes });
    if (!goal) return { error: "Failed to create goal" };
    return { created: true, id: goal.id, title: goal.title, target_pnl: goal.target_pnl, end_date: goal.end_date };
  },
  update_goal: async ({ id, ...updates }: any) => {
    const goal = await updateGoal(id, updates);
    if (!goal) return { error: `Goal ${id} not found or update failed` };
    return { updated: true, id: goal.id, title: goal.title, status: goal.status };
  },
  delete_goal: async ({ id }: any) => {
    const ok = await deleteGoal(id);
    return ok ? { deleted: true, id } : { error: `Goal ${id} not found` };
  },
  add_lesson: async ({ rule, tags, pinned, role }: any) => {
    await addLesson(rule, tags || [], { pinned: !!pinned, role: role || null });
    return { saved: true, rule, pinned: !!pinned, role: role || "all" };
  },
  pin_lesson: async ({ id }: any) => pinLesson(id),
  unpin_lesson: async ({ id }: any) => unpinLesson(id),
  list_lessons: async (opts: any) => listLessons(opts),
  clear_lessons: async ({ mode, keyword }: any) => {
    if (mode === "all") return { cleared: await clearAllLessons(), mode: "all" };
    if (mode === "performance") return { cleared: await clearPerformance(), mode: "performance" };
    if (mode === "keyword") {
      if (!keyword) return { error: "keyword required" };
      return { cleared: await removeLessonsByKeyword(keyword), mode: "keyword", keyword };
    }
    return { error: "invalid mode" };
  },
  update_config: async ({ changes, reason = "" }: any) => {
    const applied: Record<string, unknown> = {};
    const unknown: string[] = [];

    for (const [key, val] of Object.entries(changes)) {
      if (!CONFIG_MAP[key]) { unknown.push(key); continue; }
      applied[key] = val;
    }
    if (Object.keys(applied).length === 0) return { success: false, unknown, reason };

    // Update in-memory config first
    for (const [key, val] of Object.entries(applied)) {
      const [section, field] = CONFIG_MAP[key];
      (config as any)[section][field] = val;
    }

    // Save to DB as nested sections (so deepMerge in loadConfig works correctly on restart)
    const sectionsToSave = new Set<string>();
    for (const key of Object.keys(applied)) {
      sectionsToSave.add(CONFIG_MAP[key][0]);
    }
    const nestedSave: Record<string, unknown> = { _lastAgentTune: new Date().toISOString() };
    for (const section of sectionsToSave) {
      nestedSave[section] = { ...(config as any)[section] };
    }
    await saveConfig(nestedSave);

    const intervalChanged = applied.managementIntervalMin != null || applied.screeningIntervalMin != null;
    if (intervalChanged && _cronRestarter) _cronRestarter();

    const lessonsKeys = Object.keys(applied).filter((k) => k !== "managementIntervalMin" && k !== "screeningIntervalMin");
    if (lessonsKeys.length > 0) {
      const summary = lessonsKeys.map((k) => `${k}=${applied[k]}`).join(", ");
      await addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ["self_tune", "config_change"]);
    }
    return { success: true, applied, unknown, reason };
  },
};

const WRITE_TOOLS = new Set(["deploy_position", "claim_fees", "close_position", "swap_token", "withdraw_liquidity", "add_liquidity"]);

export async function executeTool(name: string, args: Record<string, any>) {
  const startTime = Date.now();
  const fn = toolMap[name];
  if (!fn) return { error: `Unknown tool: ${name}` };

  if (WRITE_TOOLS.has(name)) {
    const check = await runSafetyChecks(name, args);
    if (!check.pass) { log("safety_block", `${name} blocked: ${check.reason}`); return { blocked: true, reason: check.reason }; }
  }

  try {
    const result = await fn(args);
    const duration = Date.now() - startTime;
    const success = result?.success !== false && !result?.error;
    logAction({ tool: name, args, result: summarize(result), duration_ms: duration, success });

    if (success) {
      if (name === "swap_token" && result.tx) notifySwap({ inputSymbol: args.input_mint?.slice(0, 8), outputSymbol: args.output_mint === "SOL" ? "SOL" : args.output_mint?.slice(0, 8), amountIn: result.amount_in, amountOut: result.amount_out, tx: result.tx }).catch(() => {});
      else if (name === "deploy_position") {
        notifyDeploy({ pair: result.pool_name || args.pool_name, amountSol: args.amount_y ?? args.amount_sol ?? 0, position: result.position, tx: result.txs?.[0], priceRange: result.price_range, binStep: result.bin_step, baseFee: result.base_fee }).catch(() => {});
        appendDecision({ type: "deploy", actor: "SCREENER", pool: args.pool_address, pool_name: args.pool_name, position: result.position, summary: `Deployed ${(args.amount_y ?? args.amount_sol ?? 0).toFixed(3)} SOL into ${args.pool_name || args.pool_address?.slice(0, 8)}`, metrics: { fee_tvl_ratio: args.fee_tvl_ratio, organic_score: args.organic_score, volatility: args.volatility, strategy: args.strategy, bins_below: args.bins_below } }).catch(() => {});
      }
      else if (name === "close_position") {
        notifyClose({ pair: result.pool_name || args.position_address?.slice(0, 8), pnlUsd: result.pnl_usd ?? 0, pnlPct: result.pnl_pct ?? 0 }).catch(() => {});
        appendDecision({ type: "close", actor: "MANAGER", position: args.position_address, pool_name: result.pool_name, summary: `Closed position — PnL: ${result.pnl_pct ?? 0}% ($${result.pnl_usd ?? 0})`, metrics: { pnl_usd: result.pnl_usd, pnl_pct: result.pnl_pct, fees_earned_usd: result.fees_earned_usd, close_reason: result.close_reason } }).catch(() => {});
        if (!args.skip_swap && result.base_mint) {
          try {
            const balances = await getWalletBalances();
            const token = balances.tokens?.find((t: any) => t.mint === result.base_mint);
            if (token && (token.usd ?? 0) >= 0.10) {
              // Smart swap: check 1h price trend before swapping
              let shouldSwapNow = true;
              try {
                const { getTokenInfo } = await import("./token");
                const info = await getTokenInfo({ query: result.base_mint });
                const stats1h = (info as any)?.results?.[0]?.stats_1h;
                const priceChange1h = parseFloat(stats1h?.price_change ?? "0");
                // If token is recovering (>5% up in 1h), delay swap — agent can decide later
                if (priceChange1h > 5) {
                  shouldSwapNow = false;
                  log("swap", `Delaying swap for ${result.base_mint.slice(0, 8)}: price up ${priceChange1h}% in 1h, may recover further`);
                }
              } catch { /* if price check fails, swap anyway */ }
              if (shouldSwapNow) await swapToken({ input_mint: result.base_mint, output_mint: "SOL", amount: token.balance });
            }
          } catch { /* skip */ }
        }
      }
    }
    return result;
  } catch (error: any) {
    logAction({ tool: name, args, error: error.message, duration_ms: Date.now() - startTime, success: false });
    return { error: error.message, tool: name };
  }
}

export async function runSafetyChecks(name: string, args: any): Promise<{ pass: boolean; reason?: string }> {
  if (name === "deploy_position") {
    const s = config.screening;
    if (args.bin_step != null && (args.bin_step < s.minBinStep || args.bin_step > s.maxBinStep))
      return { pass: false, reason: `bin_step ${args.bin_step} outside [${s.minBinStep}-${s.maxBinStep}]` };

    const positions = await getMyPositions({ force: true });
    if (positions.total_positions >= config.risk.maxPositions)
      return { pass: false, reason: `Max positions (${config.risk.maxPositions}) reached` };
    if (positions.positions.some((p: any) => p.pool === args.pool_address) && !args.allow_duplicate_pool)
      return { pass: false, reason: `Already have position in pool ${args.pool_address}` };
    if (args.base_mint && positions.positions.some((p: any) => p.base_mint === args.base_mint))
      return { pass: false, reason: `Already holding token ${args.base_mint} in another pool` };

    const amountY = args.amount_y ?? args.amount_sol ?? 0;
    if (amountY > 0) {
      if (amountY > config.risk.maxDeployAmount)
        return { pass: false, reason: `Amount ${amountY} exceeds max (${config.risk.maxDeployAmount})` };
      const balance = await getWalletBalances();
      if (balance.sol < amountY + config.management.gasReserve)
        return { pass: false, reason: `Insufficient SOL: have ${balance.sol}, need ${amountY + config.management.gasReserve}` };
    }
  }
  return { pass: true };
}

function summarize(result: any) {
  const str = JSON.stringify(result);
  return str.length > 1000 ? str.slice(0, 1000) + "..." : result;
}
