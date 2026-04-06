import { NextResponse } from "next/server";
import { getTopCandidates } from "@/lib/tools/screening";

export async function GET() {
  try {
    const data = await getTopCandidates({ limit: 10 });
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
