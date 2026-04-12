import { NextRequest, NextResponse } from "next/server";
import { agentLoop } from "@/lib/agent";
import { supabase } from "@/lib/db";
import { getPendingDecision } from "@/lib/pending-decisions";

export const maxDuration = 300;

function buildDecisionContextBlock(d: any): string {
  const args = d.args ?? {};
  const lines = [
    `═══ KONTEKS KEPUTUSAN YANG SEDANG DIDISKUSIKAN ═══`,
    `ID: #${d.id} (status: ${d.status})`,
    `Action: ${d.action.toUpperCase()}`,
    `Pool: ${d.pool_name ?? "?"} (${d.pool_address ?? "?"})`,
  ];
  if (d.action === "deploy") {
    lines.push(`Amount: ${args.amount_y ?? "?"} SOL`);
    lines.push(`Strategy: ${args.strategy ?? "?"}`);
    lines.push(`Bins: below=${args.bins_below ?? "?"}, above=${args.bins_above ?? "?"}`);
    if (args.bin_step != null) lines.push(`Bin step: ${args.bin_step}`);
    if (args.volatility != null) lines.push(`Volatility: ${args.volatility}`);
    if (args.fee_tvl_ratio != null) lines.push(`fee_active_tvl_ratio: ${args.fee_tvl_ratio}`);
    if (args.organic_score != null) lines.push(`organic_score: ${args.organic_score}`);
    if (args.initial_value_usd != null) lines.push(`Initial value: $${Math.round(args.initial_value_usd)}`);
  }
  if (d.reason) lines.push(`Alasan agent: ${d.reason}`);
  if (d.risks && d.risks.length > 0) {
    lines.push(`Risks (agent):`);
    for (const r of d.risks) lines.push(`  - ${r}`);
  }
  lines.push(``);
  lines.push(`User meminta diskusi untuk double-check keputusan ini sebelum approve/reject.`);
  lines.push(`Kamu boleh memanggil tools untuk verifikasi (get_pool_detail, get_token_info,`);
  lines.push(`check_smart_wallets_on_pool, get_token_holders, search_pools, dll). Kamu juga`);
  lines.push(`boleh mengubah config via update_config kalau user setuju. Jawab pertanyaan user`);
  lines.push(`dengan data, bukan opini.`);
  lines.push(`═══════════════════════════════════════════════`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const {
    message,
    role = "GENERAL",
    model = null,
    conversation_id = null,
    pending_decision_id = null,
  } = await req.json();
  if (!message)
    return NextResponse.json({ error: "message required" }, { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send a comment every 20s so Heroku's 55s idle timeout doesn't close the connection
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 20000);

      try {
        // ── Resolve decision context if any ─────────────────────
        let decisionContext: string | null = null;
        if (pending_decision_id) {
          const decision = await getPendingDecision(Number(pending_decision_id));
          if (decision) {
            decisionContext = buildDecisionContextBlock(decision);
          }
        }

        // ── Resolve or create conversation ──────────────────────
        let convId: string = conversation_id;
        let sessionHistory: Array<{ role: string; content: string }> = [];

        if (convId) {
          // Load previous messages as session history
          const { data: prevMessages } = await supabase
            .from("chat_messages")
            .select("role, content")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: true });

          sessionHistory = (prevMessages ?? []).map((m) => ({
            role: m.role,
            content: m.content,
          }));
        } else {
          // Create a new conversation — title from first ~60 chars of message
          // (or decision-specific label if discussing a pending decision)
          const title = pending_decision_id
            ? `Diskusi Decision #${pending_decision_id}`
            : (message.length > 60 ? message.slice(0, 57) + "..." : message);
          const { data: newConv, error: convError } = await supabase
            .from("conversations")
            .insert({ title, role, model: model || null })
            .select("id")
            .single();

          if (convError) throw new Error(`Failed to create conversation: ${convError.message}`);
          convId = newConv.id;
        }

        // ── Save user message ────────────────────────────────────
        await supabase.from("chat_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message,
        });

        // ── Inject decision context as first session history entry ──
        // (only for the very first turn of a discussion conversation)
        if (decisionContext && sessionHistory.length === 0) {
          sessionHistory = [
            { role: "user", content: decisionContext },
            { role: "assistant", content: "Baik, saya paham konteks keputusan ini. Silakan lanjut bertanya atau minta saya verifikasi data." },
          ];
        }

        // ── Run agent ────────────────────────────────────────────
        const result = await agentLoop(message, 20, sessionHistory, role, model);

        // ── Save assistant response ──────────────────────────────
        await supabase.from("chat_messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: result.content,
        });

        // ── Touch conversation updated_at ────────────────────────
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convId);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ success: true, content: result.content, conversation_id: convId })}\n\n`,
          ),
        );
      } catch (error: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ success: false, error: error.message })}\n\n`,
          ),
        );
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
