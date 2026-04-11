import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/cron/runs?job=management&limit=20
// — list run history, optionally filtered by job_name.
// Logs are excluded here to keep the payload small; fetch /api/cron/runs/[id]
// for the full log trace.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const job = searchParams.get("job");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

  let query = supabase
    .from("cron_runs")
    .select("id, job_name, started_at, ended_at, duration_ms, success, error")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (job) query = query.eq("job_name", job);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
