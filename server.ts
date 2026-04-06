/**
 * Custom server entry point.
 * Runs Next.js + cron jobs + Telegram bot in a single process.
 * Used for both local dev and Heroku deployment.
 */
import next from "next";
import { createServer } from "http";
import { parse } from "url";
import { loadConfig } from "./src/lib/config";
import { initCron } from "./src/lib/cron";
import { startPolling, sendMessage, isEnabled as telegramEnabled } from "./src/lib/telegram";
import { ensureDefaultStrategies } from "./src/lib/strategy-library";
import { agentLoop } from "./src/lib/agent";
import { config } from "./src/lib/config";
import { getMyPositions, closePosition } from "./src/lib/tools/dlmm";
import { setPositionInstruction } from "./src/lib/state";
import { generateBriefing } from "./src/lib/briefing";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  console.log("[meridian] Starting server...");
  console.log(`[meridian] Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
  console.log(`[meridian] Environment: ${dev ? "development" : "production"}`);

  // 1. Load config from database
  await loadConfig();
  console.log("[meridian] Config loaded");

  // 2. Ensure default strategies exist
  await ensureDefaultStrategies();
  console.log("[meridian] Default strategies initialized");

  // 3. Start Next.js
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  server.listen(port, () => {
    console.log(`[meridian] Next.js ready on http://0.0.0.0:${port}`);
  });

  // 4. Start cron jobs
  await initCron();
  console.log("[meridian] Cron jobs started");

  // 5. Start Telegram bot (long polling)
  if (telegramEnabled()) {
    startPolling(async (text: string) => {
      try {
        // Handle commands
        if (text === "/briefing") {
          const briefing = await generateBriefing();
          await sendMessage(briefing);
          return;
        }
        if (text === "/positions") {
          const { positions, total_positions } = await getMyPositions({ force: true });
          if (total_positions === 0) { await sendMessage("No open positions."); return; }
          const lines = positions.map((p: any, i: number) => {
            const pnl = p.pnl_usd >= 0 ? `+$${p.pnl_usd}` : `-$${Math.abs(p.pnl_usd)}`;
            return `${i + 1}. ${p.pair} | $${p.total_value_usd} | PnL: ${pnl} | fees: $${p.unclaimed_fees_usd}`;
          });
          await sendMessage(`Open Positions (${total_positions}):\n\n${lines.join("\n")}\n\n/close <n> to close`);
          return;
        }

        const closeMatch = text.match(/^\/close\s+(\d+)$/i);
        if (closeMatch) {
          const idx = parseInt(closeMatch[1]) - 1;
          const { positions } = await getMyPositions({ force: true });
          if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number."); return; }
          const pos = positions[idx];
          await sendMessage(`Closing ${pos.pair}...`);
          const result = await closePosition({ position_address: pos.position });
          await sendMessage(result.success ? `Closed ${pos.pair}` : `Failed: ${JSON.stringify(result)}`);
          return;
        }

        const setMatch = text.match(/^\/set\s+(\d+)\s+(.+)$/i);
        if (setMatch) {
          const idx = parseInt(setMatch[1]) - 1;
          const note = setMatch[2].trim();
          const { positions } = await getMyPositions({ force: true });
          if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number."); return; }
          await setPositionInstruction(positions[idx].position, note);
          await sendMessage(`Note set for ${positions[idx].pair}: "${note}"`);
          return;
        }

        // Free-form chat
        const { content } = await agentLoop(text, config.llm.maxSteps, [], "GENERAL", config.llm.generalModel);
        await sendMessage(content);
      } catch (e: any) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
    });
    console.log("[meridian] Telegram bot polling started");
  }

  // 6. Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[meridian] ${signal} received, shutting down...`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[meridian] All systems operational");
}

main().catch((err) => {
  console.error("[meridian] Fatal error:", err);
  process.exit(1);
});
