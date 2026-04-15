import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: thread, error: threadError } = await supabase
    .from("studio_chat_threads")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    role?: "user" | "assistant";
    text?: string;
    agentName?: string | null;
    title?: string | null;
    provider?: string | null;
  };

  if ((body.role !== "user" && body.role !== "assistant") || !body.text?.trim()) {
    return NextResponse.json({ error: "Invalid message payload" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("studio_chat_messages")
    .insert({
      thread_id: params.id,
      user_id: user.id,
      role: body.role,
      text: body.text.trim(),
      agent_name: typeof body.agentName === "string" ? body.agentName : null,
      created_at: now,
    })
    .select("id, role, text, agent_name, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const threadPatch: Record<string, string | null> = {
    updated_at: now,
  };
  if (typeof body.title === "string" && body.title.trim()) {
    threadPatch.title = body.title.trim();
  }
  if (body.provider === null || typeof body.provider === "string") {
    threadPatch.provider = body.provider;
  }

  await supabase
    .from("studio_chat_threads")
    .update(threadPatch)
    .eq("id", params.id)
    .eq("user_id", user.id);

  return NextResponse.json({ message: data });
}
