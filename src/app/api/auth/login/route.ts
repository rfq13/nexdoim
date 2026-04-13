import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSessionToken,
  checkLoginRateLimit,
  resetLoginRateLimit,
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    // Rate limiting by IP (Heroku sets x-forwarded-for)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many login attempts. Try again in ${rateCheck.retryAfterSeconds}s`,
        },
        { status: 429 }
      );
    }

    const { password } = await req.json();
    const expectedPassword = process.env.ADMIN_PASSWORD || "meridian123";

    if (password === expectedPassword) {
      resetLoginRateLimit(ip);
      const token = createSessionToken();
      (await cookies()).set("admin_token", token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
