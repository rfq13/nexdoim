import { log } from "./logger";
import { getSecret } from "./config";
import { supabase } from "./db";

let TOKEN: string | null = null;
let BASE: string | null = null;
let chatId: string | null = null;
let _allowedPhone: string | null = null;
let _offset = 0;
let _polling = false;

function normalizePhone(phone: string): string {
  let p = phone.replace(/[^0-9]/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  return p;
}

async function refreshToken() {
  TOKEN =
    (await getSecret("TELEGRAM_BOT_TOKEN")) ||
    process.env.TELEGRAM_BOT_TOKEN ||
    null;
  BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

  if (!_allowedPhone) {
    const raw = (await getSecret("TELEGRAM_ALLOWED_PHONE")) || process.env.TELEGRAM_ALLOWED_PHONE || "";
    _allowedPhone = raw ? normalizePhone(raw) : null;
  }
}

// ─── Persistence ─────────────────────────────────────────────
async function loadChatIdFromDB(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("state")
      .select("data")
      .eq("id", "telegram_chat_id")
      .maybeSingle();
    return data?.data?.chat_id ?? null;
  } catch { return null; }
}

async function saveChatIdToDB(id: string) {
  try {
    await supabase.from("state").upsert(
      { id: "telegram_chat_id", data: { chat_id: id, verified_at: new Date().toISOString() } },
      { onConflict: "id" },
    );
    log("telegram", `Chat ID ${id} persisted to DB`);
  } catch (e: any) {
    log("telegram_error", `Failed to persist chat ID: ${e.message}`);
  }
}

export async function initTelegram() {
  await refreshToken();
  const saved = await loadChatIdFromDB();
  if (saved) {
    chatId = saved;
    log("telegram", `Loaded verified chat ID from DB: ${chatId}`);
  }
}

// ─── Sending ─────────────────────────────────────────────────
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

async function sendToChat(targetChatId: string, text: string, opts: Record<string, any> = {}) {
  await refreshToken();
  if (!TOKEN) return;
  try {
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: targetChatId, text: text.slice(0, 4096), ...opts }),
    });
  } catch (e: any) {
    log("telegram_error", `sendToChat failed: ${e.message}`);
  }
}

async function requestContactShare(targetChatId: string) {
  await refreshToken();
  if (!TOKEN) return;
  await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetChatId,
      text: "Untuk keamanan, saya perlu verifikasi nomor telepon Anda.\n\nTekan tombol di bawah untuk share kontak Anda.",
      reply_markup: {
        keyboard: [[{ text: "📱 Share Contact", request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    }),
  }).catch((e: any) => log("telegram_error", `requestContactShare failed: ${e.message}`));
}

export function setChatId(id: string) {
  chatId = id;
}

// ─── Polling ─────────────────────────────────────────────────
export async function startPolling(onMessage: (text: string) => Promise<void>) {
  await refreshToken();
  if (!TOKEN) return;
  _polling = true;
  log("telegram", "Bot polling started");

  // Ensure we have a persisted chat_id loaded
  if (!chatId) {
    const saved = await loadChatIdFromDB();
    if (saved) { chatId = saved; log("telegram", `Loaded chat ID from DB: ${chatId}`); }
  }

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
        if (!msg) continue;
        const incomingChatId = String(msg.chat.id);

        // ── Contact verification flow ─────────────────────────
        if (msg.contact && !chatId) {
          const contactPhone = normalizePhone(msg.contact.phone_number || "");
          if (_allowedPhone && contactPhone === _allowedPhone) {
            chatId = incomingChatId;
            await saveChatIdToDB(chatId);
            await sendToChat(incomingChatId, "✅ Nomor terverifikasi! Anda sekarang terhubung sebagai admin.\n\nKetik /help untuk daftar perintah.", {
              reply_markup: { remove_keyboard: true },
            });
            log("telegram", `Verified and registered chat ID: ${chatId} (phone: ${contactPhone})`);
          } else {
            await sendToChat(incomingChatId, `❌ Nomor ${msg.contact.phone_number} tidak diizinkan. Bot ini hanya untuk admin yang terdaftar.`, {
              reply_markup: { remove_keyboard: true },
            });
            log("telegram_warn", `Rejected phone: ${contactPhone} (expected: ${_allowedPhone})`);
          }
          continue;
        }

        // ── First message from unknown user → ask for contact ──
        if (!chatId) {
          if (_allowedPhone) {
            await requestContactShare(incomingChatId);
            log("telegram", `Unknown user ${incomingChatId} — requesting contact verification`);
          } else {
            // No phone restriction configured — legacy behavior: accept first user
            chatId = incomingChatId;
            await saveChatIdToDB(chatId);
            await sendMessage("Connected! I'm your LP agent.\n\n⚠️ Tip: set TELEGRAM_ALLOWED_PHONE untuk keamanan.");
            log("telegram", `Registered chat ID (no phone check): ${chatId}`);
          }
          continue;
        }

        // ── Reject messages from non-verified users ───────────
        if (incomingChatId !== chatId) {
          log("telegram_warn", `Ignored message from unauthorized chat: ${incomingChatId}`);
          continue;
        }

        // ── Forward text messages to handler ──────────────────
        if (!msg.text) continue;
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

// ─── Notification helpers ────────────────────────────────────

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

export async function notifyPendingDecision({
  id,
  action,
  poolName,
  poolAddress,
  amountSol,
  strategy,
  binsBelow,
  binsAbove,
  reason,
  risks,
  expiresInMin,
}: {
  id: number;
  action: "deploy" | "close";
  poolName?: string | null;
  poolAddress?: string | null;
  amountSol?: number;
  strategy?: string;
  binsBelow?: number;
  binsAbove?: number;
  reason?: string | null;
  risks?: string[] | null;
  expiresInMin?: number;
}) {
  const title = action === "deploy" ? "Deploy" : "Close";
  const emoji = action === "deploy" ? "🔔" : "🛑";
  const pool = poolName || poolAddress?.slice(0, 12) || "?";
  const lines = [
    `${emoji} <b>Konfirmasi ${title}</b> — <code>#${id}</code>`,
    `Pool: <b>${pool}</b>`,
  ];
  if (action === "deploy") {
    if (amountSol != null) lines.push(`Amount: ${amountSol} SOL`);
    if (strategy) lines.push(`Strategy: ${strategy}`);
    if (binsBelow != null || binsAbove != null) {
      lines.push(`Bins: below=${binsBelow ?? "?"}, above=${binsAbove ?? "?"}`);
    }
  }
  if (reason) lines.push(`Alasan: ${reason}`);
  if (risks && risks.length > 0) {
    lines.push(`Risks:`);
    for (const r of risks.slice(0, 5)) lines.push(`  • ${r}`);
  }
  if (expiresInMin != null) lines.push(`\n<i>Expires in ${expiresInMin} min</i>`);
  lines.push("");
  lines.push(`Reply <code>/approve ${id}</code> atau <code>/reject ${id}</code>`);
  lines.push(`Atau konfirmasi via web dashboard.`);

  await sendHTML(lines.join("\n"));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
