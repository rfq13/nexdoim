import { NextRequest, NextResponse } from "next/server";
import { getGoal, updateGoal, deleteGoal, syncGoalProgress, analyzeStrategy } from "@/lib/goals";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goal = await getGoal(Number(id));
  if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const progress = await syncGoalProgress(goal);
  const adjustments = analyzeStrategy(progress);
  return NextResponse.json({ ...progress, proposed_adjustments: adjustments });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const goal = await updateGoal(Number(id), body);
  if (!goal) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ goal });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteGoal(Number(id));
  if (!ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
