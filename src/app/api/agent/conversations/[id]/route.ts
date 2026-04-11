import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

// GET /api/agent/conversations/[id] — get messages for a conversation
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [convResult, msgResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, role, model, created_at, updated_at")
      .eq("id", id)
      .single(),
    supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (convResult.error) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: convResult.data, messages: msgResult.data ?? [] });
}

// DELETE /api/agent/conversations/[id] — delete a conversation and its messages
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH /api/agent/conversations/[id] — update conversation title
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { title } = await req.json().catch(() => ({}));

  const { data, error } = await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, title")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
