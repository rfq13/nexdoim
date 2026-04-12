import { NextRequest, NextResponse } from "next/server";
import { executeTool } from "@/lib/tools/executor";

// POST /api/positions/close — manually close a position.
// This is a user-initiated action (the human IS the approval), so it
// bypasses HITL pending_decisions and calls executeTool directly.
export async function POST(req: NextRequest) {
  const { position_address } = await req.json().catch(() => ({}));
  if (!position_address) {
    return NextResponse.json({ error: "position_address required" }, { status: 400 });
  }

  // Fire and forget — Heroku 30s timeout
  executeTool("close_position", { position_address }).catch(() => {});

  return NextResponse.json({ success: true, queued: true, position_address });
}
