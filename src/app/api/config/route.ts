import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { executeTool } from "@/lib/tools/executor";

export async function GET() {
  return NextResponse.json({ screening: config.screening, management: config.management, schedule: config.schedule, risk: config.risk, llm: config.llm });
}

export async function POST(req: NextRequest) {
  try {
    const { changes, reason } = await req.json();
    const result = await executeTool("update_config", { changes, reason });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
