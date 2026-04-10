import { NextResponse } from "next/server";
import { getPerformanceHistory, getPerformanceSummary } from "@/lib/lessons";

export async function GET() {
  try {
    const [summary, history] = await Promise.all([
      getPerformanceSummary(),
      getPerformanceHistory({ limit: 40 }),
    ]);
    return NextResponse.json({ summary, history });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
