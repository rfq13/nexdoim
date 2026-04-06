import { NextResponse } from "next/server";
import { runManagementCycle } from "@/lib/cron";

export async function POST() {
  try {
    const report = await runManagementCycle({ silent: true });
    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
