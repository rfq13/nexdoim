import { NextResponse } from "next/server";
import { triggerScreening } from "@/lib/cron";

// Fire-and-forget: kick off the screening cycle in the background and
// return immediately. Heroku enforces a 30s router timeout, so awaiting
// the LLM here causes H12 errors. The client polls /api/cron/runs to
// read the result + logs from `cron_runs`.
export async function POST() {
  const triggeredAt = triggerScreening();
  return NextResponse.json({
    success: true,
    triggered: true,
    job_name: "screening",
    triggered_at: triggeredAt,
  });
}
