import { NextResponse } from "next/server";
import { getMyPositions } from "@/lib/tools/dlmm";

export async function GET() {
  try {
    const data = await getMyPositions({ force: true });
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
