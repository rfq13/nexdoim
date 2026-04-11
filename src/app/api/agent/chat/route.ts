import { NextRequest, NextResponse } from "next/server";
import { agentLoop } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { message, role = "GENERAL", model = null } = await req.json();
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
        const result = await agentLoop(message, 20, [], role, model);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ success: true, content: result.content })}\n\n`,
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
