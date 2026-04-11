/**
 * Per-run logging context using AsyncLocalStorage.
 *
 * When a cron job runs inside `runStorage.run(ctx, fn)`, any call to
 * `log()` in logger.ts propagates into ctx.logs — even across awaits
 * and nested async calls. This gives us a complete per-run log trace
 * without threading a collector through every function signature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface LogEntry {
  ts: number;
  category: string;
  message: string;
}

export interface RunContext {
  jobName: string;
  logs: LogEntry[];
}

export const runStorage = new AsyncLocalStorage<RunContext>();

const MAX_LOGS_PER_RUN = 1000;

export function captureLog(category: string, message: string) {
  const ctx = runStorage.getStore();
  if (!ctx) return;
  if (ctx.logs.length >= MAX_LOGS_PER_RUN) return; // cap to prevent memory bloat
  ctx.logs.push({ ts: Date.now(), category, message });
}
