import { NextRequest, NextResponse } from "next/server";
import { listGoals, createGoal, syncGoalProgress, analyzeStrategy } from "@/lib/goals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "active";
  const withProgress = searchParams.get("progress") !== "false";

  const goals = await listGoals(status || undefined);

  if (!withProgress) return NextResponse.json({ goals });

  const goalsWithProgress = await Promise.all(
    goals.map(async (g) => {
      const progress = await syncGoalProgress(g);
      const adjustments = analyzeStrategy(progress);
      return { ...progress, proposed_adjustments: adjustments };
    })
  );

  return NextResponse.json({ goals: goalsWithProgress });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { title, target_pnl, start_date, end_date, notes } = body;

  if (!title || !target_pnl || !end_date) {
    return NextResponse.json({ error: "title, target_pnl, and end_date are required" }, { status: 400 });
  }

  const goal = await createGoal({ title, target_pnl: Number(target_pnl), start_date, end_date, notes });
  if (!goal) return NextResponse.json({ error: "Failed to create goal" }, { status: 500 });
  return NextResponse.json({ goal });
}
