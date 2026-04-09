import cron from "node-cron";
import { agentLoop } from "./agent";
import { config, computeDeployAmount, computeBinRange } from "./config";
import { log } from "./logger";
import { getMyPositions, getPositionPnl } from "./tools/dlmm";
import { getWalletBalances } from "./tools/wallet";
import { getTopCandidates } from "./tools/screening";
import { getTokenHolders, getTokenNarrative, getTokenInfo } from "./tools/token";
import { checkSmartWalletsOnPool } from "./smart-wallets";
import { studyTopLPers } from "./tools/study";
import { getTrackedPosition, getLastBriefingDate, setLastBriefingDate } from "./state";
import { getActiveStrategy } from "./strategy-library";
import { recordPositionSnapshot, recallForPool } from "./pool-memory";
import { generateBriefing } from "./briefing";
import { sendMessage, sendHTML, notifyOutOfRange, isEnabled as telegramEnabled, startPolling, stopPolling } from "./telegram";
import { registerCronRestarter } from "./tools/executor";
import { getPerformanceSummary } from "./lessons";

// ─── Market Context ──────────────────────────────────────────
async function getMarketContext(): Promise<string> {
  try {
    const res = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
    if (!res.ok) return "SOL price: unavailable";
    const data = await res.json();
    const sol = data.data?.["So11111111111111111111111111111111111111112"];
    const price = parseFloat(sol?.price ?? 0);

    // Get 24h price change from CoinGecko-compatible endpoint
    const cgRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true").catch(() => null);
    let change24h = "?";
    if (cgRes?.ok) {
      const cgData = await cgRes.json();
      change24h = (cgData.solana?.usd_24h_change ?? 0).toFixed(2);
    }

    const regime = parseFloat(change24h) > 5 ? "BULLISH" : parseFloat(change24h) < -5 ? "BEARISH" : "NEUTRAL";
    return `SOL: $${price.toFixed(2)} (24h: ${change24h}%) | Market: ${regime}`;
  } catch {
    return "SOL price: fetch failed";
  }
}

let _cronTasks: cron.ScheduledTask[] = [];
let _managementBusy = false;
let _screeningBusy = false;
let _screeningLastTriggered = 0;

export async function runManagementCycle({ silent = false } = {}) {
  log("cron", `Starting management cycle [model: ${config.llm.managementModel}]`);
  let mgmtReport: string | null = null;
  let positions: any[] = [];

  try {
    const livePositions = await getMyPositions().catch(() => null);
    positions = livePositions?.positions || [];
    if (positions.length === 0) {
      log("cron", "No open positions — triggering screening");
      runScreeningCycle().catch((e: any) => log("cron_error", `Triggered screening failed: ${e.message}`));
      return;
    }

    // Trigger screening if under max positions
    if (positions.length < config.risk.maxPositions && Date.now() - _screeningLastTriggered > 5 * 60_000) {
      _screeningLastTriggered = Date.now();
      runScreeningCycle().catch(() => {});
    }

    const [positionData, marketCtx] = await Promise.all([
      Promise.all(positions.map(async (p: any) => {
        await recordPositionSnapshot(p.pool, p);
        const pnl = await getPositionPnl({ pool_address: p.pool, position_address: p.position }).catch(() => null);
        const recall = await recallForPool(p.pool);
        return { ...p, pnl, recall };
      })),
      getMarketContext(),
    ]);

    const positionBlocks = positionData.map((p: any) => {
      const pnl = p.pnl;
      return [
        `POSITION: ${p.pair} (${p.position})`,
        `  pool: ${p.pool}`,
        `  age: ${p.age_minutes ?? "?"}m | in_range: ${p.in_range} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
        pnl ? `  pnl_pct: ${pnl.pnl_pct}% | pnl_usd: $${pnl.pnl_usd} | unclaimed_fees: $${pnl.unclaimed_fee_usd} | fee_per_tvl_24h: ${pnl.fee_per_tvl_24h ?? "?"}%` : `  pnl: fetch failed`,
        pnl ? `  bins: lower=${pnl.lower_bin} upper=${pnl.upper_bin} active=${pnl.active_bin}` : null,
        p.instruction ? `  instruction: "${p.instruction}"` : null,
        p.recall ? `  memory: ${p.recall}` : null,
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const { content } = await agentLoop(
      `MANAGEMENT CYCLE — ${positions.length} position(s)\n\nMARKET: ${marketCtx}\n\nPRE-LOADED POSITION DATA:\n${positionBlocks}\n\nApply hard close rules. In BEARISH market, lower thresholds for closing. Report format: **[PAIR]** | Age: [X]m | PnL: [X]% | [STAY/CLOSE]`,
      config.llm.maxSteps, [], "MANAGER", config.llm.managementModel, 4096
    );
    mgmtReport = content;
  } catch (error: any) {
    log("cron_error", `Management cycle failed: ${error.message}`);
    mgmtReport = `Management cycle failed: ${error.message}`;
  } finally {
    if (!silent && (await telegramEnabled()) && mgmtReport) sendMessage(`🔄 Management Cycle\n\n${mgmtReport}`).catch(() => {});
  }
  return mgmtReport;
}

export async function runScreeningCycle({ silent = false } = {}) {
  if (_screeningBusy) return;

  // Circuit breaker: pause if on losing streak
  try {
    const perf = await getPerformanceSummary();
    if (perf && perf.total_positions_closed >= 5) {
      if (perf.win_rate_pct < 25) {
        log("cron", `Circuit breaker: win rate ${perf.win_rate_pct}% < 25% over ${perf.total_positions_closed} positions — screening paused`);
        return;
      }
      if (perf.recent_streak.losses >= 4) {
        log("cron", `Circuit breaker: ${perf.recent_streak.losses} consecutive losses — screening paused`);
        return;
      }
    }
  } catch { /* continue if perf check fails */ }

  let prePositions: any, preBalance: any;
  try {
    [prePositions, preBalance] = await Promise.all([getMyPositions(), getWalletBalances()]);
    if (prePositions.total_positions >= config.risk.maxPositions) { log("cron", "Screening skipped — max positions"); return; }
    if (preBalance.sol < config.management.deployAmountSol + config.management.gasReserve) { log("cron", "Screening skipped — insufficient SOL"); return; }
  } catch (e: any) { log("cron_error", `Pre-check failed: ${e.message}`); return; }

  _screeningBusy = true;
  log("cron", `Starting screening cycle [model: ${config.llm.screeningModel}]`);
  let screenReport: string | null = null;

  try {
    const [deployAmount, activeStrategy, marketCtx] = await Promise.all([
      Promise.resolve(computeDeployAmount(preBalance.sol)),
      getActiveStrategy(),
      getMarketContext(),
    ]);
    const strategyBlock = activeStrategy
      ? `ACTIVE STRATEGY: ${activeStrategy.name} — LP: ${activeStrategy.lpStrategy}`
      : "No active strategy — use default bid_ask.";

    const topCandidates = await getTopCandidates({ limit: 5 }).catch(() => null);
    const candidates = topCandidates?.candidates || [];

    const candidateBlocks: string[] = [];
    for (let i = 0; i < Math.min(candidates.length, 5); i++) {
      const pool = candidates[i];
      const mint = pool.base?.mint;
      const [sw, h, n, ti, mem, lpers] = await Promise.allSettled([
        checkSmartWalletsOnPool({ pool_address: pool.pool }),
        mint ? getTokenHolders({ mint, limit: 100 }) : Promise.resolve(null),
        mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
        mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
        Promise.resolve(await recallForPool(pool.pool)),
        i < 3 ? studyTopLPers({ pool_address: pool.pool, limit: 3 }).catch(() => null) : Promise.resolve(null),
      ]);

      const swVal = sw.status === "fulfilled" ? sw.value : null;
      const tiVal = ti.status === "fulfilled" ? (ti.value as any)?.results?.[0] : null;
      const nVal = n.status === "fulfilled" ? n.value : null;

      const suggestedBins = computeBinRange(pool.volatility ?? 3, pool.bin_step ?? 80);
      const lpersVal = lpers.status === "fulfilled" ? lpers.value : null;
      const lpersPatterns = (lpersVal as any)?.patterns;
      candidateBlocks.push([
        `POOL: ${pool.name} (${pool.pool})`,
        `  metrics: bin_step=${pool.bin_step}, fee_tvl=${pool.fee_active_tvl_ratio}, vol=$${pool.volume}, tvl=$${pool.active_tvl}, volatility=${pool.volatility}`,
        `  suggested_bins: below=${suggestedBins.binsBelow}, above=${suggestedBins.binsAbove} (based on volatility)`,
        `  smart_wallets: ${(swVal as any)?.in_pool?.length ?? 0} present`,
        lpersPatterns ? `  top_lpers: ${lpersPatterns.top_lper_count} found, avg_win_rate=${lpersPatterns.avg_win_rate}%, avg_hold=${lpersPatterns.avg_hold_hours}h, best_roi=${lpersPatterns.best_roi}` : null,
        nVal && (nVal as any).narrative ? `  narrative: ${(nVal as any).narrative.slice(0, 300)}` : `  narrative: none`,
        (mem as any).value ? `  memory: ${(mem as any).value}` : null,
      ].filter(Boolean).join("\n"));
    }

    const { content } = await agentLoop(
      `SCREENING CYCLE\nMARKET: ${marketCtx}\n${strategyBlock}\nPositions: ${prePositions.total_positions}/${config.risk.maxPositions} | SOL: ${preBalance.sol.toFixed(3)} | Deploy: ${deployAmount} SOL\n\nIn BEARISH market, raise entry bar — only deploy on strongest candidates.\n\n${candidateBlocks.join("\n\n")}`,
      config.llm.maxSteps, [], "SCREENER", config.llm.screeningModel, 2048
    );
    screenReport = content;
  } catch (error: any) {
    log("cron_error", `Screening cycle failed: ${error.message}`);
    screenReport = `Screening cycle failed: ${error.message}`;
  } finally {
    _screeningBusy = false;
    if (!silent && (await telegramEnabled()) && screenReport) sendMessage(`🔍 Screening Cycle\n\n${screenReport}`).catch(() => {});
  }
  return screenReport;
}

async function runBriefing() {
  try {
    const briefing = await generateBriefing();
    if (await telegramEnabled()) await sendHTML(briefing);
    await setLastBriefingDate();
  } catch (error: any) { log("cron_error", `Morning briefing failed: ${error.message}`); }
}

async function maybeRunMissedBriefing() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastSent = await getLastBriefingDate();
  if (lastSent === todayUtc) return;
  if (new Date().getUTCHours() < 1) return;
  log("cron", `Missed briefing detected — sending now`);
  await runBriefing();
}

export function startCronJobs() {
  stopCronJobs();

  const mgmtTask = cron.schedule(`*/${Math.max(1, config.schedule.managementIntervalMin)} * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    try { await runManagementCycle(); } finally { _managementBusy = false; }
  });

  const screenTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, () => { runScreeningCycle(); });

  const healthTask = cron.schedule(`0 * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    try { await agentLoop("HEALTH CHECK — summarize portfolio health.", config.llm.maxSteps, [], "MANAGER"); }
    catch (e: any) { log("cron_error", `Health check failed: ${e.message}`); }
    finally { _managementBusy = false; }
  });

  const briefingTask = cron.schedule(`0 1 * * *`, runBriefing, { timezone: "UTC" });
  const briefingWatchdog = cron.schedule(`0 */6 * * *`, maybeRunMissedBriefing, { timezone: "UTC" });

  _cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog];
  log("cron", `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
}

export function stopCronJobs() {
  for (const task of _cronTasks) task.stop();
  _cronTasks = [];
}

export async function initCron() {
  registerCronRestarter(() => startCronJobs());
  startCronJobs();
  await maybeRunMissedBriefing().catch(() => {});
}
