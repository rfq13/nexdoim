import { NextRequest, NextResponse } from "next/server";
import { listPendingDecisions, type PendingStatus } from "@/lib/pending-decisions";

export const dynamic = "force-dynamic";

// GET /api/pending-decisions?status=pending&limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status");
  // Empty string = no filter (all statuses); null (not provided) defaults to "pending"
  const statusParam = statusRaw === "" ? null : (statusRaw as PendingStatus | null) ?? "pending";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

  const rows = await listPendingDecisions(statusParam, limit);
  return NextResponse.json({ decisions: rows });
}
