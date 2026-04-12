import { NextRequest, NextResponse } from "next/server";
import { listPendingDecisions, type PendingStatus } from "@/lib/pending-decisions";

export const dynamic = "force-dynamic";

// GET /api/pending-decisions?status=pending&limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") as PendingStatus | null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

  const rows = await listPendingDecisions(statusParam ?? "pending", limit);
  return NextResponse.json({ decisions: rows });
}
