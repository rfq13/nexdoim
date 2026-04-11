import { NextRequest, NextResponse } from "next/server";
import { agentLoop } from "@/lib/agent";
import { supabase } from "@/lib/db";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { message, role = "GENERAL", model = null, conversation_id = null } = await req.json();
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
          const title = message.length > 60 ? message.slice(0, 57) + "..." : message;
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
