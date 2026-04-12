/**
 * Auto-initialize cron when any server module imports this file.
 *
 * Needed because `next dev` doesn't run the custom `server.ts` that
 * normally calls `initCron()`. Without this, the scheduler stays
 * permanently inactive in dev mode.
 *
 * Safe in production too: `initCron()` is idempotent (see its globalThis
 * guard), so calling it from both server.ts and this module is harmless.
 *
 * Opt out with `DISABLE_CRON_AUTO_INIT=true` env var.
 */
import { initCron } from "./cron";
import { loadConfig } from "./config";
import { ensureDefaultStrategies } from "./strategy-library";
import { initTelegram } from "./telegram";

const g = globalThis as any;

if (!g.__meridian_cron_auto_init_started && process.env.DISABLE_CRON_AUTO_INIT !== "true") {
  g.__meridian_cron_auto_init_started = true;

  (async () => {
    try {
      await loadConfig();
      await ensureDefaultStrategies();
      await initTelegram();
      await initCron();
      console.log("[cron-auto-init] scheduler started");
    } catch (e: any) {
      console.error("[cron-auto-init] failed:", e?.message ?? e);
      // Allow retry on next import
      g.__meridian_cron_auto_init_started = false;
    }
  })();
}
