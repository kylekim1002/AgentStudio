import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { canViewLesson } from "@/lib/collab/access";
import { logLessonActivity } from "@/lib/collab/activity";

async function getLatestDeleteRequestState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lessonId: string
) {
  const { data: activities } = await (supabase as any)
    .from("lesson_activities")
    .select("action, actor_id, created_at")
    .eq("lesson_id", lessonId)
    .in("action", ["delete_requested", "delete_request_cancelled", "deleted"])
    .order("created_at", { ascending: false })
    .limit(5);

  for (const activity of activities ?? []) {
    if (activity.action === "delete_requested") {
      return {
        pending: true,
        requesterId: activity.actor_id ?? null,
        requestedAt: activity.created_at ?? null,
      };
    }

    if (activity.action === "delete_request_cancelled" || activity.action === "deleted") {
      return {
        pending: false,
        requesterId: null,
        requestedAt: null,
      };
    }
  }

  return {
    pending: false,
    requesterId: null,
    requestedAt: null,
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  const { data: lesson } = await (supabase as any)
    .from("lessons")
    .select("id, user_id, reviewer_id, title")
    .eq("id", id)
    .single();

  if (!lesson || !canViewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (access.role === "admin") {
    return NextResponse.json(
      { error: "관리자는 삭제 요청 없이 바로 삭제할 수 있습니다." },
      { status: 400 }
    );
  }

  if (lesson.user_id !== user.id) {
    return NextResponse.json({ error: "삭제 요청은 작성자만 할 수 있습니다." }, { status: 403 });
  }

  const currentState = await getLatestDeleteRequestState(supabase, id);
  if (currentState.pending) {
    return NextResponse.json({ error: "이미 삭제 요청이 접수되었습니다." }, { status: 400 });
  }

  await logLessonActivity(supabase as any, {
    lessonId: id,
    actorId: user.id,
    action: "delete_requested",
    metadata: {
      delete_request_pending: true,
    },
  });

  return NextResponse.json({
    ok: true,
    delete_request_pending: true,
    delete_request_requested_at: new Date().toISOString(),
    delete_request_requester_id: user.id,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

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

  const currentState = await getLatestDeleteRequestState(supabase, id);
  if (!currentState.pending) {
    return NextResponse.json({ error: "취소할 삭제 요청이 없습니다." }, { status: 400 });
  }

  if (access.role !== "admin" && currentState.requesterId !== user.id) {
    return NextResponse.json({ error: "삭제 요청은 요청자만 취소할 수 있습니다." }, { status: 403 });
  }

  await logLessonActivity(supabase as any, {
    lessonId: id,
    actorId: user.id,
    action: "delete_request_cancelled",
    metadata: {
      delete_request_pending: false,
      requester_id: currentState.requesterId,
    },
  });

  return NextResponse.json({
    ok: true,
    delete_request_pending: false,
    delete_request_requested_at: null,
    delete_request_requester_id: null,
  });
}
