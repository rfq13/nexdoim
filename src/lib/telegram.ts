import { log } from "./logger";
import { getSecret } from "./config";

let TOKEN: string | null = null;
let BASE: string | null = null;
let chatId: string | null = null;
let _offset = 0;
let _polling = false;

async function refreshToken() {
  TOKEN =
    (await getSecret("TELEGRAM_BOT_TOKEN")) ||
    process.env.TELEGRAM_BOT_TOKEN ||
    null;
  BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
}

export async function isEnabled() {
  await refreshToken();
  return !!TOKEN;
}

export async function sendMessage(text: string) {
  await refreshToken();
  if (!TOKEN || !chatId) return;
  try {
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4096),
      }),
    });
  } catch (e: any) {
    log("telegram_error", `sendMessage failed: ${e.message}`);
  }
}

export async function sendHTML(html: string) {
  await refreshToken();
  if (!TOKEN || !chatId) return;
  try {
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html.slice(0, 4096),
        parse_mode: "HTML",
      }),
    });
  } catch (e: any) {
    log("telegram_error", `sendHTML failed: ${e.message}`);
  }
}

export function setChatId(id: string) {
  chatId = id;
}

export async function startPolling(onMessage: (text: string) => Promise<void>) {
  await refreshToken();
  if (!TOKEN) return;
  _polling = true;
  log("telegram", "Bot polling started");

  while (_polling) {
    try {
      await refreshToken();
      const res = await fetch(
        `${BASE}/getUpdates?offset=${_offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) },
      );
      if (!res.ok) {
        await sleep(5000);
        continue;
      }
      const data = await res.json();
      for (const update of data.result || []) {
        _offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        const incomingChatId = String(msg.chat.id);
        if (!chatId) {
          chatId = incomingChatId;
          log("telegram", `Registered chat ID: ${chatId}`);
          await sendMessage("Connected! I'm your LP agent.");
        }
        if (incomingChatId !== chatId) continue;
        await onMessage(msg.text);
      }
    } catch (e: any) {
      if (!e.message?.includes("aborted"))
        log("telegram_error", `Poll error: ${e.message}`);
      await sleep(5000);
    }
  }
}

export function stopPolling() {
  _polling = false;
}

export async function notifyDeploy({
  pair,
  amountSol,
  position,
  tx,
  priceRange,
  binStep,
  baseFee,
}: any) {
  const priceStr = priceRange
    ? `Price range: ${priceRange.min < 0.0001 ? priceRange.min.toExponential(3) : priceRange.min.toFixed(6)} – ${priceRange.max < 0.0001 ? priceRange.max.toExponential(3) : priceRange.max.toFixed(6)}\n`
    : "";
  const poolStr =
    binStep || baseFee
      ? `Bin step: ${binStep ?? "?"}  |  Base fee: ${baseFee != null ? baseFee + "%" : "?"}\n`
      : "";
  await sendHTML(
    `✅ <b>Deployed</b> ${pair}\nAmount: ${amountSol} SOL\n${priceStr}${poolStr}Position: <code>${position?.slice(0, 8)}...</code>`,
  );
}

export async function notifyClose({ pair, pnlUsd, pnlPct }: any) {
  const sign = pnlUsd >= 0 ? "+" : "";
  await sendHTML(
    `🔒 <b>Closed</b> ${pair}\nPnL: ${sign}$${(pnlUsd ?? 0).toFixed(2)} (${sign}${(pnlPct ?? 0).toFixed(2)}%)`,
  );
}

export async function notifySwap({
  inputSymbol,
  outputSymbol,
  amountIn,
  amountOut,
  tx,
}: any) {
  await sendHTML(
    `🔄 <b>Swapped</b> ${inputSymbol} → ${outputSymbol}\nIn: ${amountIn ?? "?"} | Out: ${amountOut ?? "?"}`,
  );
}

export async function notifyOutOfRange({ pair, minutesOOR }: any) {
  await sendHTML(
    `⚠️ <b>Out of Range</b> ${pair}\nBeen OOR for ${minutesOOR} minutes`,
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
