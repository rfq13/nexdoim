import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { resetLLMClient } from "@/lib/llm";

const DEPRECATED_SECRET_KEYS = ["LLM_API_KEY"];

export async function GET() {
  try {
    // Best-effort cleanup for deprecated secrets.
    await supabase.from("secrets").delete().in("key", DEPRECATED_SECRET_KEYS);

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
    await supabase.from("secrets").delete().in("key", DEPRECATED_SECRET_KEYS);

    const { key, value } = await req.json();
    if (!key || value === undefined || value === null) {
      return NextResponse.json(
        { error: "Key and value are required" },
        { status: 400 },
      );
    }

    if (String(key).toUpperCase() === "LLM_API_KEY") {
      return NextResponse.json(
        {
          error:
            "LLM_API_KEY is deprecated. Use OLLAMA_API_KEY or OPENROUTER_API_KEY.",
        },
        { status: 400 },
      );
    }

    const { data: secret, error } = await supabase
      .from("secrets")
      .upsert({ key, value: String(value) }, { onConflict: "key" })
      .select()
      .single();

    if (error) throw error;

    // Force re-init so subsequent agent requests use the latest credentials.
    resetLLMClient();

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

    // Deleting a key should also invalidate any cached LLM client credentials.
    resetLLMClient();

    return NextResponse.json({ message: "Secret deleted" });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete secret" },
      { status: 500 },
    );
  }
}
