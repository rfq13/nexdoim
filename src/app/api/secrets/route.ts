import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const secrets = await prisma.secret.findMany({
      orderBy: { updatedAt: "desc" },
    });

    // Mask values for security
    const maskedSecrets = secrets.map((s) => ({
      ...s,
      value:
        s.value.length > 8
          ? `${s.value.substring(0, 4)}...${s.value.substring(s.value.length - 4)}`
          : "********",
    }));

    return NextResponse.json(maskedSecrets);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch secrets" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { key, value } = await req.json();
    if (!key || !value) {
      return NextResponse.json(
        { error: "Key and value are required" },
        { status: 400 },
      );
    }

    const secret = await prisma.secret.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return NextResponse.json(secret);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save secret" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    await prisma.secret.delete({
      where: { key },
    });

    return NextResponse.json({ message: "Secret deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete secret" },
      { status: 500 },
    );
  }
}
