import { NextResponse } from "next/server";
import { getCronStatus, runManagementCycle, runScreeningCycle } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getCronStatus());
}

// POST /api/cron/status { action: "run_management" | "run_screening" }
// — manual trigger for testing that the scheduler plumbing works end-to-end.
export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}));

  if (action === "run_management") {
    runManagementCycle({ silent: true }).catch(() => {});
    return NextResponse.json({ success: true, triggered: "management" });
  }
  if (action === "run_screening") {
    runScreeningCycle({ silent: true }).catch(() => {});
    return NextResponse.json({ success: true, triggered: "screening" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
