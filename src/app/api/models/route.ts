import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getModelCatalogForProvider, getDefaultModel, getProvider } from "@/lib/llm";

export async function GET(req: NextRequest) {
  const providerOverride = req.nextUrl.searchParams.get("provider") as "ollama" | "openrouter" | null;
  const provider = providerOverride || getProvider();
  const models = await getModelCatalogForProvider(provider);
  return NextResponse.json({
    models,
    provider,
    defaultModel: getDefaultModel(),
    active: {
      generalModel: config.llm.generalModel,
      managementModel: config.llm.managementModel,
      screeningModel: config.llm.screeningModel,
    },
  });
}
