import { NextResponse } from "next/server";
import { getRecentDecisions } from "@/lib/decision-log";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const decisions = await getRecentDecisions(Math.min(limit, 200));
    return NextResponse.json({ total: decisions.length, decisions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
