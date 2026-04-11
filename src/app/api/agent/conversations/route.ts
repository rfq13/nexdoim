import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

// GET /api/agent/conversations — list all conversations, newest first
export async function GET() {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, role, model, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

// POST /api/agent/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const { title, role = "GENERAL", model } = await req.json().catch(() => ({}));

  const { data, error } = await supabase
    .from("conversations")
    .insert({ title: title || null, role, model: model || null })
    .select("id, title, role, model, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
