import { NextRequest, NextResponse } from "next/server";
import { agentLoop } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const { message, role = "GENERAL", model = null } = await req.json();
    if (!message)
      return NextResponse.json({ error: "message required" }, { status: 400 });
    const result = await agentLoop(message, 20, [], role, model);
    return NextResponse.json({ success: true, content: result.content });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
