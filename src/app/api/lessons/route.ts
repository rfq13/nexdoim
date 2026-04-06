import { NextRequest, NextResponse } from "next/server";
import { listLessons, getPerformanceSummary } from "@/lib/lessons";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") || undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
    const [lessons, perf] = await Promise.all([listLessons({ role, limit }), getPerformanceSummary()]);
    return NextResponse.json({ ...lessons, performance: perf });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
