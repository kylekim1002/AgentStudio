import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: threads, error } = await supabase
    .from("studio_chat_threads")
    .select("id, title, provider, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const threadIds = (threads ?? []).map((thread) => thread.id);
  const { data: messages } = threadIds.length
    ? await supabase
        .from("studio_chat_messages")
        .select("thread_id, content, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const messageMap = new Map<
    string,
    {
      count: number;
      lastMessagePreview: string | null;
      lastMessageAt: string | null;
    }
  >();

  for (const message of messages ?? []) {
    const current = messageMap.get(message.thread_id) ?? {
      count: 0,
      lastMessagePreview: null,
      lastMessageAt: null,
    };
    messageMap.set(message.thread_id, {
      count: current.count + 1,
      lastMessagePreview: current.lastMessagePreview ?? message.content,
      lastMessageAt: current.lastMessageAt ?? message.created_at,
    });
  }

  return NextResponse.json({
    threads: (threads ?? []).map((thread) => {
      const meta = messageMap.get(thread.id);
      return {
        ...thread,
        messageCount: meta?.count ?? 0,
        lastMessagePreview: meta?.lastMessagePreview ?? null,
        lastMessageAt: meta?.lastMessageAt ?? null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    provider?: string | null;
  };

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "새 프로젝트";
  const provider = typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : null;

  const { data, error } = await supabase
    .from("studio_chat_threads")
    .insert({
      user_id: user.id,
      title,
      provider,
    })
    .select("id, title, provider, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ thread: { ...data, messageCount: 0, lastMessagePreview: null, lastMessageAt: null } });
}
