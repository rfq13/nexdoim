import { NextResponse } from "next/server";
import { loadWeights, recalculateWeights } from "@/lib/signal-weights";
import { supabase } from "@/lib/db";
import { config } from "@/lib/config";

export async function GET() {
  try {
    const data = await loadWeights();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const { data: perfRows } = await supabase.from("performance").select("*");
    const result = await recalculateWeights(perfRows ?? [], config);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
