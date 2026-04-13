import { NextRequest, NextResponse } from "next/server";
import { config, saveConfig } from "@/lib/config";
import { resetLLMClient } from "@/lib/llm";

export async function GET() {
  return NextResponse.json({
    screening: config.screening,
    management: config.management,
    schedule: config.schedule,
    risk: config.risk,
    llm: config.llm,
    darwin: config.darwin,
    strategy: config.strategy,
    safety: config.safety,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Direct section save: { section: "screening", data: { minBinStep: 20, ... } }
    if (body.section && body.data && typeof body.data === "object") {
      const { section, data } = body;
      const allowed = ["screening", "management", "schedule", "risk", "llm", "darwin", "strategy", "safety"];
      if (!allowed.includes(section)) {
        return NextResponse.json({ error: `Unknown section: ${section}` }, { status: 400 });
      }
      // Merge into in-memory config
      (config as any)[section] = { ...(config as any)[section], ...data };
      // Persist to Supabase as nested section
      await saveConfig({ [section]: (config as any)[section] });
      if (section === "llm" && data.provider) resetLLMClient();
      return NextResponse.json({ success: true, section, saved: (config as any)[section] });
    }

    // Legacy key-by-key changes (kept for agent tool compatibility)
    const { executeTool } = await import("@/lib/tools/executor");
    const { changes, reason } = body;
    const result = await executeTool("update_config", { changes, reason });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
