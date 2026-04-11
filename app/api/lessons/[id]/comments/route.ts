import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { canViewLesson } from "@/lib/collab/access";
import { logLessonActivity } from "@/lib/collab/activity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getViewerAccess(supabase, user);

  const { data: lesson } = await (supabase as any)
    .from("lessons")
    .select("id, user_id, reviewer_id")
    .eq("id", id)
    .single();

  if (!lesson || !canViewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await (supabase as any)
    .from("lesson_comments")
    .select("id, lesson_id, user_id, body, created_at")
    .eq("lesson_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getViewerAccess(supabase, user);

  const { data: lesson } = await (supabase as any)
    .from("lessons")
    .select("id, user_id, reviewer_id")
    .eq("id", id)
    .single();

  if (!lesson || !canViewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const { data, error } = await (supabase as any)
    .from("lesson_comments")
    .insert({
      lesson_id: id,
      user_id: user.id,
      body: body.body.trim(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logLessonActivity(supabase, {
    lessonId: id,
    actorId: user.id,
    action: "commented",
    metadata: {
      note: body.body.trim(),
    },
  });

  return NextResponse.json({
    comment: {
      ...data,
      author_name: access.name,
      author_role: access.role,
    },
  }, { status: 201 });
}
