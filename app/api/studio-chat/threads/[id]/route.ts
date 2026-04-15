import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: { id: string } };

async function getAuthedThread(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, thread: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: thread, error: threadError } = await supabase
    .from("studio_chat_threads")
    .select("id, user_id, title, provider, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (threadError || !thread) {
    return { supabase, user, thread: null, error: NextResponse.json({ error: "Thread not found" }, { status: 404 }) };
  }

  return { supabase, user, thread, error: null };
}

export async function GET(_: NextRequest, { params }: Params) {
  const result = await getAuthedThread(params.id);
  if (result.error) return result.error;

  const { supabase, thread } = result;
  const { data: messages, error } = await supabase
    .from("studio_chat_messages")
    .select("id, role, content, agent_name, created_at")
    .eq("thread_id", params.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    thread,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      agent_name: message.agent_name,
      created_at: message.created_at,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const result = await getAuthedThread(params.id);
  if (result.error) return result.error;

  const { supabase } = result;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    provider?: string | null;
  };

  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (body.provider === null || typeof body.provider === "string") {
    patch.provider = body.provider;
  }

  const { data, error } = await supabase
    .from("studio_chat_threads")
    .update(patch)
    .eq("id", params.id)
    .select("id, title, provider, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ thread: data });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const result = await getAuthedThread(params.id);
  if (result.error) return result.error;

  const { supabase } = result;
  const { error } = await supabase
    .from("studio_chat_threads")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
