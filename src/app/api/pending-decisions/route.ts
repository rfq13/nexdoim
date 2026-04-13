import { NextRequest, NextResponse } from "next/server";
import {
  createPendingDecision,
  listPendingDecisions,
  type PendingStatus,
} from "@/lib/pending-decisions";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// GET /api/pending-decisions?status=pending&limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status");
  // Empty string = no filter (all statuses); null (not provided) defaults to "pending"
  const statusParam =
    statusRaw === ""
      ? null
      : ((statusRaw as PendingStatus | null) ?? "pending");
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "20", 10) || 20,
    100,
  );

  const rows = await listPendingDecisions(statusParam, limit);
  return NextResponse.json({ decisions: rows });
}

// POST /api/pending-decisions
// Create a pending decision manually from chat DECISION_JSON payload.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision as Record<string, any> | undefined;

  if (!decision || typeof decision !== "object") {
    return NextResponse.json(
      { error: "decision object required" },
      { status: 400 },
    );
  }

  const action = String(decision.action ?? "").toUpperCase();
  if (action !== "DEPLOY") {
    return NextResponse.json(
      { error: "Only DEPLOY decision can be converted to pending." },
      { status: 400 },
    );
  }

  const poolAddress = decision.pool_address;
  if (!poolAddress || typeof poolAddress !== "string") {
    return NextResponse.json(
      { error: "decision.pool_address required" },
      { status: 400 },
    );
  }

  const pending = await createPendingDecision({
    action: "deploy",
    pool_address: poolAddress,
    pool_name:
      typeof decision.pool_name === "string" ? decision.pool_name : undefined,
    args: {
      pool_address: poolAddress,
      pool_name:
        typeof decision.pool_name === "string" ? decision.pool_name : undefined,
      amount_y:
        typeof decision.amount_y === "number"
          ? decision.amount_y
          : config.management.deployAmountSol,
      bins_below:
        typeof decision.bins_below === "number"
          ? decision.bins_below
          : config.strategy.binsBelow,
      bins_above:
        typeof decision.bins_above === "number" ? decision.bins_above : 0,
      strategy:
        typeof decision.strategy === "string" ? decision.strategy : "bid_ask",
      bin_step:
        typeof decision.bin_step === "number" ? decision.bin_step : undefined,
      volatility:
        typeof decision.volatility === "number"
          ? decision.volatility
          : undefined,
    },
    reason:
      typeof decision.reason === "string"
        ? decision.reason
        : "Created from chat DECISION_JSON",
    risks: Array.isArray(decision.risks)
      ? decision.risks.filter((r: unknown) => typeof r === "string")
      : [],
  });

  if (!pending) {
    return NextResponse.json(
      { error: "Failed to create pending decision" },
      { status: 500 },
    );
  }

  return NextResponse.json({ pending_id: pending.id, decision: pending });
}
