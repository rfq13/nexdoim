import { NextRequest, NextResponse } from "next/server";
import { getGoal, syncGoalProgress, analyzeStrategy } from "@/lib/goals";
import { createPendingDecision } from "@/lib/pending-decisions";

// POST /api/goals/[id]/apply-adjustments
// Creates a pending_decision for each config change section so user can
// approve/reject via HITL before config is actually modified.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goal = await getGoal(Number(id));
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  const progress = await syncGoalProgress(goal);
  const adjustments = analyzeStrategy(progress);
  if (!adjustments) {
    return NextResponse.json({ error: "No adjustments needed — goal is on track" }, { status: 400 });
  }

  // Create a single pending decision for the config adjustment bundle
  const pending = await createPendingDecision({
    action: "deploy", // reuse type — config changes are "deploying" a new strategy
    pool_name: `Config Adjustment: ${goal.title}`,
    args: {
      type: "config_adjustment",
      goal_id: goal.id,
      changes: adjustments.changes,
      reason: adjustments.reason,
    },
    reason: adjustments.reason,
    risks: [adjustments.risk_note],
  });

  if (!pending) {
    return NextResponse.json({ error: "Failed to create pending decision" }, { status: 500 });
  }

  return NextResponse.json({ success: true, pending_id: pending.id, adjustments });
}
