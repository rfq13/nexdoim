import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET() {
  try {
    const { data: secretsData, error } = await supabase
      .from("secrets")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    const secrets = secretsData ?? [];

    const maskedSecrets = secrets.map((secret: any) => ({
      ...secret,
      value:
        secret.value.length > 8
          ? `${secret.value.substring(0, 4)}...${secret.value.substring(secret.value.length - 4)}`
          : "********",
    }));

    return NextResponse.json(maskedSecrets);
  } catch {
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

    const { data: secret, error } = await supabase
      .from("secrets")
      .upsert({ key, value }, { onConflict: "key" })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(secret);
  } catch {
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

    const { error } = await supabase.from("secrets").delete().eq("key", key);
    if (error) throw error;

    return NextResponse.json({ message: "Secret deleted" });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete secret" },
      { status: 500 },
    );
  }
}
