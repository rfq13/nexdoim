import { NextRequest, NextResponse } from "next/server";
import { getPendingDecision } from "@/lib/pending-decisions";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getPendingDecision(Number(id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ decision: row });
}
