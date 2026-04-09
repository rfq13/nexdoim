import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET() {
  try {
    const { data: secrets, error } = await supabase
      .from("secrets")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    // Mask values for security
    const maskedSecrets = secrets.map((s: any) => ({
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
      );{ data: secret, error } = await supabase
      .from("secrets")
      .upsert({ key, value })
      .select()
      .single();

    if (error) throw errorwhere: { key },
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
    const { error } = await supabase
      .from("secrets")
      .delete()
      .eq("key", key);

    if (error) throw errorait prisma.secret.delete({
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
