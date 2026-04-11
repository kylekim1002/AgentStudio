import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LessonStatus } from "@/lib/collab/lesson";
import { getViewerAccess } from "@/lib/authz/server";
import { canDeleteLesson, canReviewLesson, canViewLesson } from "@/lib/collab/access";
import { logLessonActivity } from "@/lib/collab/activity";

// GET /api/lessons/[id] — 레슨 상세 (package 포함)
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

  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewLesson(access, data as { user_id: string; reviewer_id?: string | null })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: comments } = await (supabase as any)
    .from("lesson_comments")
    .select("id, lesson_id, user_id, body, created_at")
    .eq("lesson_id", id)
    .order("created_at", { ascending: true });

  const { data: activities } = await (supabase as any)
    .from("lesson_activities")
    .select("id, lesson_id, actor_id, action, metadata, created_at")
    .eq("lesson_id", id)
    .order("created_at", { ascending: false });

  const profileIds = [
    data.user_id,
    data.reviewer_id,
    ...((comments ?? []).map((comment: { user_id: string }) => comment.user_id)),
    ...((activities ?? []).map((activity: { actor_id?: string | null }) => activity.actor_id)),
  ].filter(Boolean);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("id", Array.from(new Set(profileIds)));

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const latestAssignmentActivity = (activities ?? []).find(
    (activity: { action?: string }) => activity.action === "reviewer_assigned"
  ) as
    | {
        metadata?: {
          note?: string | null;
        } | null;
      }
    | undefined;
  const assignmentNote = latestAssignmentActivity?.metadata?.note ?? null;

  const lesson = {
    ...data,
    owner_name: profileMap.get(data.user_id)?.name ?? null,
    reviewer_name: data.reviewer_id ? profileMap.get(data.reviewer_id)?.name ?? null : null,
    assignment_mode: assignmentNote?.includes("자동 배정") ? "auto" : data.reviewer_id ? "manual" : null,
    assignment_note: assignmentNote,
  };

  const enrichedComments = (comments ?? []).map((comment: { user_id: string }) => ({
    ...comment,
    author_name: profileMap.get(comment.user_id)?.name ?? null,
    author_role: profileMap.get(comment.user_id)?.role ?? null,
  }));

  const enrichedActivities = (activities ?? []).map((activity: { actor_id?: string | null; metadata?: { reviewer_id?: string | null; previous_reviewer_id?: string | null } | null }) => ({
    ...activity,
    actor_name: activity.actor_id ? profileMap.get(activity.actor_id)?.name ?? null : null,
    actor_role: activity.actor_id ? profileMap.get(activity.actor_id)?.role ?? null : null,
    metadata: activity.metadata
      ? {
          ...activity.metadata,
          reviewer_name: activity.metadata.reviewer_id ? profileMap.get(activity.metadata.reviewer_id)?.name ?? null : null,
          previous_reviewer_name: activity.metadata.previous_reviewer_id ? profileMap.get(activity.metadata.previous_reviewer_id)?.name ?? null : null,
        }
      : null,
  }));

  return NextResponse.json({ lesson, comments: enrichedComments, activities: enrichedActivities });
}

// DELETE /api/lessons/[id] — 레슨 삭제
export async function DELETE(
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

  if (!lesson || !canDeleteLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("lessons")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

// PATCH /api/lessons/[id] — 협업 상태 업데이트
export async function PATCH(
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

  let body: {
    status?: LessonStatus;
    review_notes?: string | null;
    reviewer_id?: string | null;
    reviewer_reason?: string | null;
    review_template?: {
      used?: boolean;
      kind?: "approved" | "needs_revision" | null;
      text?: string | null;
    } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch = {
    status: body.status,
    review_notes: body.review_notes,
    reviewer_id: body.reviewer_id,
    reviewed_at: undefined,
    submitted_at: body.status === "in_review" ? new Date().toISOString() : undefined,
  } as Record<string, unknown>;

  const { data: lesson } = await (supabase as any)
    .from("lessons")
    .select("id, user_id, reviewer_id, status")
    .eq("id", id)
    .single();

  if (!lesson || !canViewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isOwner = access.user.id === lesson.user_id;
  const isReviewAction = body.status === "approved" || body.status === "needs_revision";

  if (isReviewAction && !canReviewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.status === "in_review" && !isOwner) {
    return NextResponse.json({ error: "Only owner can request review" }, { status: 403 });
  }

  if (body.reviewer_id && !isOwner && !access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Only owner can assign reviewer" }, { status: 403 });
  }

  if (body.reviewer_id) {
    const { data: reviewer } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", body.reviewer_id)
      .single();

    if (!reviewer || !["admin", "lead_teacher", "reviewer"].includes(reviewer.role)) {
      return NextResponse.json({ error: "Invalid reviewer" }, { status: 400 });
    }
  }

  if (body.status === "approved") {
    patch.reviewed_at = new Date().toISOString();
  }

  if (body.status === "needs_revision") {
    patch.reviewed_at = new Date().toISOString();
  }

  const { data, error } = await (supabase as any)
    .from("lessons")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.reviewer_id && body.reviewer_id !== lesson.reviewer_id) {
    await logLessonActivity(supabase, {
      lessonId: id,
      actorId: user.id,
      action: "reviewer_assigned",
      metadata: {
        reviewer_id: body.reviewer_id,
        previous_reviewer_id: lesson.reviewer_id ?? null,
        note: body.reviewer_reason ?? null,
      },
    });
  }

  if (body.status && body.status !== lesson.status) {
    const action =
      body.status === "in_review"
        ? "submitted_for_review"
        : body.status === "approved"
          ? "approved"
          : body.status === "needs_revision"
            ? "revision_requested"
            : "status_changed";

    await logLessonActivity(supabase, {
      lessonId: id,
      actorId: user.id,
      action,
      metadata: {
        from_status: lesson.status,
        to_status: body.status,
        note: body.review_notes ?? null,
        reviewer_id: data.reviewer_id ?? null,
        template_used: body.review_template?.used ?? false,
        template_kind: body.review_template?.kind ?? null,
        template_text: body.review_template?.text ?? null,
      },
    });
  }

  return NextResponse.json({ lesson: data });
}
