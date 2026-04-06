import { NextResponse } from "next/server";
import { getWalletBalances } from "@/lib/tools/wallet";

export async function GET() {
  try {
    const data = await getWalletBalances();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
