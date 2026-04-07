import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getModelCatalog, getDefaultModel } from "@/lib/llm";

export async function GET() {
  const models = await getModelCatalog();
  return NextResponse.json({
    models,
    defaultModel: getDefaultModel(),
    active: {
      generalModel: config.llm.generalModel,
      managementModel: config.llm.managementModel,
      screeningModel: config.llm.screeningModel,
    },
  });
}
