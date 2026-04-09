import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    // Hardcoded static password at backend (bypassing dynamic configs)
    const expectedPassword = process.env.ADMIN_PASSWORD || "meridian123";

    if (!expectedPassword) {
      return NextResponse.json(
        { error: "ADMIN_PASSWORD is not configured in DB or .env" },
        { status: 500 }
      );
    }

    if (password === expectedPassword) {
      (await cookies()).set("admin_token", "authenticated", {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
