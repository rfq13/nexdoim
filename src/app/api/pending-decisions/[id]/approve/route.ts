import { NextRequest, NextResponse } from "next/server";
import { approvePendingDecision } from "@/lib/pending-decisions";

export const maxDuration = 300;

// POST /api/pending-decisions/[id]/approve — approve and execute.
// Long-running (deploy tx submission), but since Heroku has 30s router
// timeout, we kick off execution async and return immediately with the
// claimed state. The client polls /api/pending-decisions/[id] for
// the final executed/failed status.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Fire-and-forget: kick off approval/execution in background
  approvePendingDecision(numId, "web").catch((e: any) => {
    console.error(`[pending-decisions] approval failed for #${numId}:`, e?.message ?? e);
  });

  return NextResponse.json({ success: true, id: numId, queued: true });
}
