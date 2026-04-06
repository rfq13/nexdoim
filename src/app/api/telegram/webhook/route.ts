import { NextRequest, NextResponse } from "next/server";
import { agentLoop } from "@/lib/agent";
import { sendMessage, setChatId } from "@/lib/telegram";
import { getMyPositions, closePosition } from "@/lib/tools/dlmm";
import { setPositionInstruction } from "@/lib/state";
import { generateBriefing } from "@/lib/briefing";
import { config } from "@/lib/config";

let _chatId: string | null = process.env.TELEGRAM_CHAT_ID || null;

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg?.text) return NextResponse.json({ ok: true });

    const incomingChatId = String(msg.chat.id);
    if (!_chatId) { _chatId = incomingChatId; setChatId(_chatId); await sendMessage("Connected!"); }
    if (incomingChatId !== _chatId) return NextResponse.json({ ok: true });

    const text = msg.text;

    if (text === "/briefing") {
      const briefing = await generateBriefing();
      await sendMessage(briefing);
      return NextResponse.json({ ok: true });
    }

    if (text === "/positions") {
      const { positions, total_positions } = await getMyPositions({ force: true });
      if (total_positions === 0) { await sendMessage("No open positions."); return NextResponse.json({ ok: true }); }
      const lines = positions.map((p: any, i: number) => `${i + 1}. ${p.pair} | $${p.total_value_usd} | PnL: ${p.pnl_usd >= 0 ? "+" : ""}$${p.pnl_usd}`);
      await sendMessage(`Open Positions (${total_positions}):\n\n${lines.join("\n")}`);
      return NextResponse.json({ ok: true });
    }

    // Free-form: route through agent
    const { content } = await agentLoop(text, config.llm.maxSteps, [], "GENERAL", config.llm.generalModel);
    await sendMessage(content);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
