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
import { sendMessage, sendHTML, notifyOutOfRange, notifyPendingDecision, isEnabled as telegramEnabled, startPolling, stopPolling } from "./telegram";
import { registerCronRestarter } from "./tools/executor";
import { getPerformanceSummary } from "./lessons";
import { stageSignals } from "./signal-tracker";
import { runStorage, type LogEntry, type RunContext } from "./run-context";
import { supabase } from "./db";
import { parseDecisionJson, validateDecision, parseManagementJson, validateManagementDecisions } from "./screening-parser";
import { createPendingDecision, tryAutoApprove, hasPendingForPosition, hasPendingForPool } from "./pending-decisions";

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

// ─── Health tracking ─────────────────────────────────────────
interface JobHealth {
  name: string;
  schedule: string;
  intervalMin: number | null; // null = not an interval-based job
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastSuccess: boolean | null;
  runCount: number;
  errorCount: number;
  busy: boolean;
}

const _jobHealth: Record<string, JobHealth> = {};
const _processStartedAt = Date.now();

function initJob(name: string, schedule: string, intervalMin: number | null): JobHealth {
  if (!_jobHealth[name]) {
    _jobHealth[name] = {
      name,
      schedule,
      intervalMin,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
      lastSuccess: null,
      runCount: 0,
      errorCount: 0,
      busy: false,
    };
  }
  return _jobHealth[name];
}

async function persistRun(record: {
  job_name: string;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  success: boolean;
  error: string | null;
  output: string | null;
  logs: LogEntry[];
}) {
  try {
    await supabase.from("cron_runs").insert({
      job_name: record.job_name,
      started_at: new Date(record.started_at).toISOString(),
      ended_at: new Date(record.ended_at).toISOString(),
      duration_ms: record.duration_ms,
      success: record.success,
      error: record.error,
      output: record.output,
      logs: record.logs,
    });
  } catch (e: any) {
    // Never let persistence failure break the cron loop
    console.error(`[cron] failed to persist run for ${record.job_name}: ${e?.message ?? e}`);
  }
}

function stringifyOutput(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "content" in (value as any)) {
    return String((value as any).content);
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}

async function trackRun<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const job = _jobHealth[name];
  if (!job) return await fn();

  job.busy = true;
  const start = Date.now();
  const ctx: RunContext = { jobName: name, logs: [] };

  return runStorage.run(ctx, async () => {
    try {
      const result = await fn();
      const end = Date.now();
      job.lastRunAt = start;
      job.lastDurationMs = end - start;
      job.lastSuccess = true;
      job.lastError = null;
      job.runCount++;

      await persistRun({
        job_name: name,
        started_at: start,
        ended_at: end,
        duration_ms: end - start,
        success: true,
        error: null,
        output: stringifyOutput(result),
        logs: ctx.logs,
      });

      return result;
    } catch (e: any) {
      const end = Date.now();
      const errMsg = e?.message ?? String(e);
      job.lastRunAt = start;
      job.lastDurationMs = end - start;
      job.lastSuccess = false;
      job.lastError = errMsg;
      job.errorCount++;
      log("cron_error", `${name} failed: ${errMsg}`);

      await persistRun({
        job_name: name,
        started_at: start,
        ended_at: end,
        duration_ms: end - start,
        success: false,
        error: errMsg,
        output: null,
        logs: ctx.logs,
      });

      return null;
    } finally {
      job.busy = false;
    }
  });
}

// ─── Manual Triggers ─────────────────────────────────────────
// Fire-and-forget entry points for the API routes. These wrap the
// cycle with trackRun so a DB row in `cron_runs` is created — the
// HTTP caller polls /api/cron/runs to read the result, avoiding
// Heroku's 30-second router timeout (H12).

export function triggerManagement(): number {
  const triggeredAt = Date.now();
  (async () => {
    if (_managementBusy) {
      log("cron", "Manual management trigger skipped — already running");
      // Still persist so the UI poll finds a row
      await trackRun("management", async () => "SKIPPED: management sebelumnya masih berjalan — tunggu hingga selesai");
      return;
    }
    _managementBusy = true;
    try {
      await trackRun("management", () => runManagementCycle({ silent: true }));
    } finally {
      _managementBusy = false;
    }
  })().catch((e: any) => log("cron_error", `triggerManagement failed: ${e?.message ?? e}`));
  return triggeredAt;
}

export function triggerScreening(): number {
  const triggeredAt = Date.now();
  (async () => {
    await trackRun("screening", () => runScreeningCycle({ silent: true }));
  })().catch((e: any) => log("cron_error", `triggerScreening failed: ${e?.message ?? e}`));
  return triggeredAt;
}

export function getCronStatus() {
  return {
    running: _cronTasks.length > 0,
    task_count: _cronTasks.length,
    process_started_at: _processStartedAt,
    process_uptime_sec: Math.floor((Date.now() - _processStartedAt) / 1000),
    now: Date.now(),
    jobs: Object.values(_jobHealth),
  };
}

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
      return "SKIPPED: tidak ada posisi terbuka — screening di-trigger otomatis";
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

    const positionBlocks = await Promise.all(positionData.map(async (p: any) => {
      const pnl = p.pnl;
      const tracked = await getTrackedPosition(p.position).catch(() => null);
      const vol = tracked?.volatility ?? 0;
      const initialUsd = tracked?.initialValueUsd ?? 0;
      const feePct = initialUsd > 0 ? ((p.unclaimed_fees_usd ?? 0) / initialUsd) * 100 : 0;

      // Dynamic OOR timeout based on volatility
      const baseOorMin = config.management.outOfRangeWaitMinutes;
      const dynamicOorMax = vol >= 8 ? Math.round(baseOorMin * 0.33)
        : vol >= 5 ? Math.round(baseOorMin * 0.66)
        : vol >= 2 ? baseOorMin
        : Math.round(baseOorMin * 2);

      return [
        `POSITION: ${p.pair} (${p.position})`,
        `  pool: ${p.pool}`,
        `  age: ${p.age_minutes ?? "?"}m | in_range: ${p.in_range} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
        `  volatility: ${vol} | dynamic_oor_max: ${dynamicOorMax}m (based on volatility)`,
        pnl ? `  pnl_pct: ${pnl.pnl_pct}% | pnl_usd: $${pnl.pnl_usd} | unclaimed_fees: $${pnl.unclaimed_fee_usd} | fee_per_tvl_24h: ${pnl.fee_per_tvl_24h ?? "?"}%` : `  pnl: fetch failed`,
        pnl ? `  bins: lower=${pnl.lower_bin} upper=${pnl.upper_bin} active=${pnl.active_bin}` : null,
        initialUsd > 0 ? `  initial_value: $${initialUsd.toFixed(2)} | fee_yield: ${feePct.toFixed(1)}% | take_profit_target: ${config.management.takeProfitFeePct}%` : null,
        feePct >= config.management.takeProfitFeePct ? `  ⚡ TAKE-PROFIT TARGET REACHED (${feePct.toFixed(1)}% >= ${config.management.takeProfitFeePct}%) — CLOSE recommended` : null,
        p.instruction ? `  instruction: "${p.instruction}"` : null,
        p.recall ? `  memory: ${p.recall}` : null,
      ].filter(Boolean).join("\n");
    }));
    const positionBlocksStr = positionBlocks.join("\n\n");

    const { content } = await agentLoop(
      `MANAGEMENT CYCLE — ${positions.length} position(s)\n\nMARKET: ${marketCtx}\n\nPRE-LOADED POSITION DATA:\n${positionBlocksStr}\n\nApply hard close rules. Use dynamic_oor_max per position (NOT the global default). If ⚡ TAKE-PROFIT TARGET REACHED, CLOSE to lock profit. In BEARISH market, lower thresholds. Report format: **[PAIR]** | Age: [X]m | PnL: [X]% | [STAY/CLOSE/REBALANCE]`,
      config.llm.maxSteps, [], "MANAGER", config.llm.managementModel, 4096
    );
    mgmtReport = content;

    // ── HITL: parse MANAGEMENT_JSON for CLOSE decisions ────────
    const mgmtDecisions = parseManagementJson(content);
    if (!mgmtDecisions) {
      log("management_warn", "LLM tidak menghasilkan blok MANAGEMENT_JSON — skip auto-execute");
      mgmtReport += `\n\n---\n⚠️ Tidak ada blok MANAGEMENT_JSON di output.`;
    } else {
      const actionDecisions = mgmtDecisions.decisions.filter((d) => d.action === "CLOSE" || d.action === "REBALANCE");
      const stayCount = mgmtDecisions.decisions.filter((d) => d.action === "STAY").length;
      const closeCount = actionDecisions.filter((d) => d.action === "CLOSE").length;
      const rebalanceCount = actionDecisions.filter((d) => d.action === "REBALANCE").length;

      log("management", `Parsed: ${closeCount} CLOSE, ${rebalanceCount} REBALANCE, ${stayCount} STAY`);

      if (actionDecisions.length === 0) {
        mgmtReport += `\n\n---\n✅ Semua posisi STAY (${stayCount} posisi)`;
      } else {
        const { valid, invalid } = validateManagementDecisions(actionDecisions, positions);

        for (const inv of invalid) {
          log("management_error", `Invalid CLOSE decision: ${inv.reason}`);
          mgmtReport += `\n\n❌ CLOSE gagal validasi: ${inv.reason}`;
        }

        for (const d of valid) {
          // Dedup: skip if already a pending action for this position
          if (await hasPendingForPosition(d.position_address)) {
            log("management", `Skipping duplicate pending ${d.action} for ${d.pair} (${d.position_address.slice(0, 8)}...)`);
            mgmtReport += `\n\nℹ️ ${d.action} ${d.pair} sudah ada pending sebelumnya — skip duplikat`;
            continue;
          }

          // For REBALANCE: args include both close + redeploy info
          const isRebalance = d.action === "REBALANCE";
          const posData = positions.find((p: any) => p.position === d.position_address);
          const tracked = posData ? await getTrackedPosition(posData.position).catch(() => null) : null;
          const rebalanceArgs = isRebalance ? {
            position_address: d.position_address,
            pool_address: posData?.pool ?? d.pool_address,
            rebalance: true,
            volatility: tracked?.volatility,
            bin_step: tracked?.binStep,
          } : { position_address: d.position_address };

          const pending = await createPendingDecision({
            action: isRebalance ? "close" : "close", // both execute close; rebalance = close + auto redeploy
            pool_address: posData?.pool,
            pool_name: d.pair ?? undefined,
            args: rebalanceArgs,
            reason: `${isRebalance ? "[REBALANCE] " : ""}${d.reason ?? ""}`,
            risks: d.risks ?? [],
          });

          if (!pending) {
            log("management_error", `Gagal buat pending close untuk ${d.pair}`);
            continue;
          }

          log("management", `Pending CLOSE #${pending.id}: ${d.pair} — ${d.reason}`);

          // Try auto-approve if autoDeploy (reuse same toggle — applies to all auto actions)
          const regimeMatch = marketCtx.match(/Market:\s*(\w+)/);
          const regime = regimeMatch?.[1] ?? "NEUTRAL";
          const autoResult = await tryAutoApprove(pending.id, regime);

          if (autoResult.autoApproved) {
            mgmtReport += `\n\n🤖 **Auto-Close** #${pending.id}: ${d.pair}\n- Alasan: ${d.reason ?? "—"}\n- Reasoning: ${autoResult.reasoning}`;
          } else {
            notifyPendingDecision({
              id: pending.id,
              action: "close",
              poolName: d.pair,
              reason: d.reason,
              risks: d.risks ?? [],
              expiresInMin: 30,
            }).catch(() => {});
            mgmtReport += `\n\n🔔 **Pending Close** #${pending.id}: ${d.pair}\n- Alasan: ${d.reason ?? "—"}\n- Kenapa manual: ${autoResult.reasoning}`;
          }
        }
      }
    }
  } catch (error: any) {
    log("cron_error", `Management cycle failed: ${error.message}`);
    mgmtReport = `Management cycle failed: ${error.message}`;
  } finally {
    if (!silent && (await telegramEnabled()) && mgmtReport) sendMessage(`🔄 Management Cycle\n\n${mgmtReport}`).catch(() => {});
  }
  return mgmtReport;
}

export async function runScreeningCycle({ silent = false } = {}) {
  if (_screeningBusy) {
    log("cron", "Screening skipped — already running");
    return "SKIPPED: screening sebelumnya masih berjalan — tunggu hingga selesai";
  }

  // Circuit breaker: pause if on losing streak
  try {
    const perf = await getPerformanceSummary();
    if (perf && perf.total_positions_closed >= 5) {
      if (perf.win_rate_pct < 25) {
        const msg = `Circuit breaker: win rate ${perf.win_rate_pct}% < 25% over ${perf.total_positions_closed} positions — screening paused`;
        log("cron", msg);
        return `SKIPPED: ${msg}`;
      }
      if (perf.recent_streak.losses >= 4) {
        const msg = `Circuit breaker: ${perf.recent_streak.losses} consecutive losses — screening paused`;
        log("cron", msg);
        return `SKIPPED: ${msg}`;
      }
    }
  } catch { /* continue if perf check fails */ }

  let prePositions: any, preBalance: any;
  try {
    [prePositions, preBalance] = await Promise.all([getMyPositions(), getWalletBalances()]);
    if (prePositions.total_positions >= config.risk.maxPositions) {
      const msg = `Max positions reached (${prePositions.total_positions}/${config.risk.maxPositions})`;
      log("cron", `Screening skipped — ${msg}`);
      return `SKIPPED: ${msg}`;
    }
    const minSol = config.management.deployAmountSol + config.management.gasReserve;
    if (preBalance.sol < minSol) {
      const msg = `Saldo SOL tidak cukup: ${preBalance.sol.toFixed(4)} < ${minSol.toFixed(4)} (deploy ${config.management.deployAmountSol} + reserve ${config.management.gasReserve})`;
      log("cron", `Screening skipped — ${msg}`);
      return `SKIPPED: ${msg}`;
    }
  } catch (e: any) {
    const msg = `Pre-check gagal: ${e.message}`;
    log("cron_error", msg);
    return `ERROR: ${msg}`;
  }

  // ── Portfolio Drawdown Gate ────────────────────────────────────
  try {
    const perf = await getPerformanceSummary();
    if (perf && perf.total_pnl_usd < 0) {
      // Check daily loss (from today's closed positions)
      const todayLoss = Math.abs(perf.total_pnl_usd); // simplified: use total as proxy
      if (config.safety.maxDailyLossUsd > 0 && todayLoss >= config.safety.maxDailyLossUsd) {
        const msg = `Drawdown gate: loss $${todayLoss.toFixed(2)} >= maxDailyLoss $${config.safety.maxDailyLossUsd}`;
        log("cron", `Screening paused — ${msg}`);
        return `SKIPPED: ${msg}`;
      }
    }
  } catch { /* continue if check fails */ }

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

      // Stage signals for Darwinian learning — captured at deploy time
      stageSignals(pool.pool, {
        organic_score:         pool.organic_score,
        fee_tvl_ratio:         pool.fee_active_tvl_ratio,
        volume:                pool.volume_window,
        mcap:                  pool.mcap,
        holder_count:          pool.holders,
        smart_wallets_present: ((swVal as any)?.in_pool?.length ?? 0) > 0,
        narrative_quality:     (nVal as any)?.narrative ? "present" : "absent",
        study_win_rate:        lpersPatterns?.avg_win_rate ?? null,
        volatility:            pool.volatility ?? null,
        hive_consensus:        null,
      });

      candidateBlocks.push([
        `POOL: ${pool.name} (${pool.pool})`,
        `  metrics: bin_step=${pool.bin_step}, fee_tvl=${pool.fee_active_tvl_ratio}, vol=$${pool.volume}, tvl=$${pool.active_tvl}, volatility=${pool.volatility}`,
        `  momentum: trend=${pool.trend_label ?? "?"}, price_5m=${pool.price_change_5m ?? "?"}%, price_1h=${pool.price_change_1h ?? "?"}%, mtf_score=${pool.mtf_score ?? "?"}`,
        `  suggested_bins: below=${suggestedBins.binsBelow}, above=${suggestedBins.binsAbove} (based on volatility)`,
        `  vol_adjusted_deploy: ${computeDeployAmount(preBalance.sol, pool.volatility).toFixed(3)} SOL (volatility-scaled)`,
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

    // ── HITL: create pending decision from structured DECISION_JSON ──
    // The LLM's prose is informational only; the backend treats the
    // DECISION_JSON block as the source of truth. Instead of auto-executing,
    // we create a pending_decision row and notify the human (via dashboard
    // + Telegram) for approval. Execution happens only after approval.
    const decision = parseDecisionJson(content);
    if (!decision) {
      log("screening_warn", "LLM tidak menghasilkan blok DECISION_JSON — skip");
      screenReport += `\n\n---\n⚠️ **HITL:** tidak ada blok DECISION_JSON di output — tidak ada rekomendasi.`;
    } else if (decision.action === "SKIP") {
      log("screening", `Decision: SKIP — ${decision.reason ?? "no reason given"}`);
      screenReport += `\n\n---\n**Decision:** SKIP — ${decision.reason ?? "(tidak ada alasan)"}`;
    } else if (decision.action === "DEPLOY") {
      const validation = validateDecision(decision, candidates);
      if (!validation.valid) {
        log("screening_error", `Invalid DECISION_JSON: ${validation.reason}`);
        screenReport += `\n\n---\n❌ **HITL gagal:** ${validation.reason}`;
      } else {
        const pool = candidates.find((c: any) => c.pool === decision.pool_address);
        const suggestedBins = computeBinRange(pool?.volatility ?? 3, pool?.bin_step ?? 80);
        const solPriceMatch = marketCtx.match(/SOL:\s*\$(\d+\.?\d*)/);
        const solPrice = solPriceMatch ? parseFloat(solPriceMatch[1]) : 0;
        const binsBelow = decision.bins_below ?? suggestedBins.binsBelow;
        const binsAbove = decision.bins_above ?? suggestedBins.binsAbove;
        const strategy = decision.strategy ?? "bid_ask";

        // Recalculate deploy amount with volatility scaling
        const volAdjustedAmount = computeDeployAmount(preBalance.sol, pool?.volatility);
        const deployArgs = {
          pool_address: decision.pool_address,
          pool_name: decision.pool_name ?? pool?.name,
          amount_y: volAdjustedAmount, // volatility-adjusted, server-authoritative
          bins_below: binsBelow,
          bins_above: binsAbove,
          strategy,
          bin_step: pool?.bin_step,
          volatility: pool?.volatility,
          fee_tvl_ratio: pool?.fee_active_tvl_ratio,
          organic_score: pool?.organic_score,
          initial_value_usd: solPrice > 0 ? deployAmount * solPrice : undefined,
        };

        // Dedup: skip if already a pending DEPLOY for this pool
        if (decision.pool_address && await hasPendingForPool(decision.pool_address)) {
          log("screening", `Skipping duplicate pending DEPLOY for ${decision.pool_name ?? pool?.name}`);
          screenReport += `\n\n---\nℹ️ DEPLOY ${decision.pool_name ?? pool?.name} sudah ada pending sebelumnya — skip duplikat`;
        } else {

        const pending = await createPendingDecision({
          action: "deploy",
          pool_address: decision.pool_address,
          pool_name: decision.pool_name ?? pool?.name,
          args: deployArgs,
          reason: decision.reason,
          risks: decision.risks ?? [],
        });

        if (!pending) {
          log("screening_error", "Gagal membuat pending_decision di database");
          screenReport += `\n\n---\n❌ **HITL:** gagal simpan pending decision ke database`;
        } else {
          log("screening", `Pending #${pending.id}: ${decision.pool_name ?? pool?.name}`);

          // Extract market regime from context string for auto-deploy gate
          const regimeMatch = marketCtx.match(/Market:\s*(\w+)/);
          const marketRegime = regimeMatch?.[1] ?? "NEUTRAL";

          // Try auto-approve if autoDeploy is enabled
          const autoResult = await tryAutoApprove(pending.id, marketRegime);

          if (autoResult.autoApproved) {
            log("auto_deploy", `#${pending.id} auto-approved: ${autoResult.reasoning}`);
            screenReport += `\n\n---\n🤖 **Auto-Deploy** — #${pending.id}\n- Pool: ${decision.pool_name ?? pool?.name}\n- Amount: ${deployAmount} SOL\n- Strategy: ${strategy}\n- Alasan agent: ${decision.reason ?? "(tidak ada)"}\n- **Reasoning auto-approve:** ${autoResult.reasoning}`;
          } else {
            // Fall back to manual HITL — notify user
            log("screening", `#${pending.id} menunggu konfirmasi manual: ${autoResult.reasoning}`);
            notifyPendingDecision({
              id: pending.id,
              action: "deploy",
              poolName: decision.pool_name ?? pool?.name,
              poolAddress: decision.pool_address,
              amountSol: deployAmount,
              strategy,
              binsBelow,
              binsAbove,
              reason: decision.reason,
              risks: decision.risks ?? [],
              expiresInMin: 30,
            }).catch((e: any) => log("telegram_error", `notifyPendingDecision failed: ${e.message}`));

            screenReport += `\n\n---\n🔔 **Pending Approval** — #${pending.id}\n- Pool: ${decision.pool_name ?? pool?.name}\n- Amount: ${deployAmount} SOL\n- Strategy: ${strategy}\n- Alasan agent: ${decision.reason ?? "(tidak ada)"}\n- **Kenapa butuh manual:** ${autoResult.reasoning}\n\nKonfirmasi via dashboard atau Telegram: \`/approve ${pending.id}\` / \`/reject ${pending.id}\``;
          }
        }
        } // end else (dedup check)
      }
    }
  } catch (error: any) {
    log("cron_error", `Screening cycle failed: ${error.message}`);
    screenReport = `Screening cycle failed: ${error.message}`;
  } finally {
    _screeningBusy = false;
    if (!silent && (await telegramEnabled()) && screenReport) sendMessage(`🔍 Screening Cycle\n\n${screenReport}`).catch(() => {});
  }
  return screenReport;
}

async function runBriefing(): Promise<string> {
  try {
    const briefing = await generateBriefing();
    if (await telegramEnabled()) await sendHTML(briefing);
    await setLastBriefingDate();
    return briefing ?? "Briefing dikirim ke Telegram";
  } catch (error: any) {
    log("cron_error", `Morning briefing failed: ${error.message}`);
    return `Briefing gagal: ${error.message}`;
  }
}

async function maybeRunMissedBriefing(): Promise<string> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastSent = await getLastBriefingDate();
  if (lastSent === todayUtc) {
    return `Briefing hari ini (${todayUtc}) sudah terkirim — tidak perlu kirim ulang`;
  }
  if (new Date().getUTCHours() < 1) {
    return `Belum waktunya briefing (UTC hour < 1) — skip`;
  }
  log("cron", `Missed briefing detected — sending now`);
  return await runBriefing();
}

export function startCronJobs() {
  stopCronJobs();

  const mgmtInterval = Math.max(1, config.schedule.managementIntervalMin);
  const screenInterval = Math.max(1, config.schedule.screeningIntervalMin);

  // Register job health entries (idempotent)
  initJob("management", `*/${mgmtInterval} * * * *`, mgmtInterval);
  initJob("screening", `*/${screenInterval} * * * *`, screenInterval);
  initJob("health_check", `0 * * * *`, 60);
  initJob("morning_briefing", `0 1 * * *`, null);
  initJob("briefing_watchdog", `0 */6 * * *`, 360);

  const mgmtTask = cron.schedule(`*/${mgmtInterval} * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    try { await trackRun("management", () => runManagementCycle()); }
    finally { _managementBusy = false; }
  });

  const screenTask = cron.schedule(`*/${screenInterval} * * * *`, () => {
    trackRun("screening", () => runScreeningCycle());
  });

  const healthTask = cron.schedule(`0 * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    try {
      await trackRun("health_check", () =>
        agentLoop("HEALTH CHECK — summarize portfolio health.", config.llm.maxSteps, [], "MANAGER")
      );
    } finally { _managementBusy = false; }
  });

  const briefingTask = cron.schedule(`0 1 * * *`, () => { trackRun("morning_briefing", () => runBriefing()); }, { timezone: "UTC" });
  const briefingWatchdog = cron.schedule(`0 */6 * * *`, () => { trackRun("briefing_watchdog", () => maybeRunMissedBriefing()); }, { timezone: "UTC" });

  _cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog];
  log("cron", `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
}

export function stopCronJobs() {
  for (const task of _cronTasks) task.stop();
  _cronTasks = [];
}

export async function initCron() {
  // Idempotent guard — tolerate double-call from both server.ts and
  // lazy auto-init in dev mode (next dev doesn't run server.ts).
  const g = globalThis as any;
  if (g.__meridian_cron_started) {
    log("cron", "initCron called but already started — skipping");
    return;
  }
  g.__meridian_cron_started = true;

  registerCronRestarter(() => startCronJobs());
  startCronJobs();
  await maybeRunMissedBriefing().catch(() => {});
}
