import { NextResponse } from "next/server";
import { triggerManagement } from "@/lib/cron";

// Fire-and-forget: kick off the management cycle in the background and
// return immediately. Heroku enforces a 30s router timeout, so awaiting
// the LLM here causes H12 errors. The client polls /api/cron/runs to
// read the result + logs from `cron_runs`.
export async function POST() {
  const triggeredAt = triggerManagement();
  return NextResponse.json({
    success: true,
    triggered: true,
    job_name: "management",
    triggered_at: triggeredAt,
  });
}
