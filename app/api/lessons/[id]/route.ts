import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { LessonStatus } from "@/lib/collab/lesson";
import { getViewerAccess } from "@/lib/authz/server";
import { canDeleteLesson, canReviewLesson, canViewLesson } from "@/lib/collab/access";
import { logLessonActivity } from "@/lib/collab/activity";

const REVIEWER_ROLES = ["admin", "lead_teacher", "reviewer"];

function resolveDeleteRequestState(
  activities: Array<{
    action?: string | null;
    actor_id?: string | null;
    created_at?: string | null;
  }>
) {
  for (const activity of activities) {
    if (activity.action === "delete_requested") {
      return {
        pending: true,
        requested_at: activity.created_at ?? null,
        requester_id: activity.actor_id ?? null,
      };
    }

    if (activity.action === "delete_request_cancelled" || activity.action === "deleted") {
      return {
        pending: false,
        requested_at: null,
        requester_id: null,
      };
    }
  }

  return {
    pending: false,
    requested_at: null,
    requester_id: null,
  };
}

async function resolveRecommendedReviewerId(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data: reviewerProfiles } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("role", REVIEWER_ROLES)
    .order("name", { ascending: true });

  const reviewerIds = (reviewerProfiles ?? []).map((profile) => profile.id);
  if (reviewerIds.length === 0) return null;

  const { data: queueRows } = await supabase
    .from("lessons")
    .select("reviewer_id, submitted_at")
    .in("reviewer_id", reviewerIds)
    .eq("status", "in_review");

  const now = Date.now();
  const queueMap = new Map<string, number[]>();
  for (const row of queueRows ?? []) {
    if (!row.reviewer_id || !row.submitted_at) continue;
    const hours =
      Math.max(0, Math.round((((now - new Date(row.submitted_at).getTime()) / (1000 * 60 * 60)) * 10))) /
      10;
    queueMap.set(row.reviewer_id, [...(queueMap.get(row.reviewer_id) ?? []), hours]);
  }

  const sorted = (reviewerProfiles ?? [])
    .map((profile) => {
      const rows = queueMap.get(profile.id) ?? [];
      const queueCount = rows.length;
      const averageWaitHours =
        queueCount > 0
          ? Math.round((rows.reduce((sum, hour) => sum + hour, 0) / queueCount) * 10) / 10
          : 0;

      return {
        id: profile.id,
        queueCount,
        averageWaitHours,
        name: profile.name ?? "이름 미지정",
      };
    })
    .sort((a, b) => {
      if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
      if (a.averageWaitHours !== b.averageWaitHours) return a.averageWaitHours - b.averageWaitHours;
      return a.name.localeCompare(b.name, "ko");
    });

  return sorted[0]?.id ?? null;
}

// GET /api/lessons/[id] — 레슨 상세 (package 포함)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const serviceSupabase = await createServiceClient();
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

  const deleteRequestState = resolveDeleteRequestState(
    (activities ?? []) as Array<{
      action?: string | null;
      actor_id?: string | null;
      created_at?: string | null;
    }>
  );

  return NextResponse.json({
    lesson: {
      ...lesson,
      delete_request_pending: deleteRequestState.pending,
      delete_request_requested_at: deleteRequestState.requested_at,
      delete_request_requester_id: deleteRequestState.requester_id,
    },
    comments: enrichedComments,
    activities: enrichedActivities,
  });
}

// DELETE /api/lessons/[id] — 레슨 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const serviceSupabase = await createServiceClient();
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

  if (!lesson || access.role !== "admin" || !canDeleteLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await logLessonActivity(supabase as any, {
    lessonId: id,
    actorId: user.id,
    action: "deleted",
    metadata: {
      delete_request_pending: false,
    },
  });

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
  const serviceSupabase = await createServiceClient();
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
    package?: Record<string, unknown>;
    title?: string;
    project_id?: string | null;
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
    title: body.title,
    project_id: body.project_id,
    reviewed_at: undefined,
    submitted_at: body.status === "in_review" ? new Date().toISOString() : undefined,
  } as Record<string, unknown>;

  const { data: lesson } = await (serviceSupabase as any)
    .from("lessons")
    .select("id, user_id, reviewer_id, status, project_id, title")
    .eq("id", id)
    .single();

  if (!lesson || !canViewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isOwner = access.user.id === lesson.user_id;
  const isReviewAction = body.status === "approved" || body.status === "needs_revision";
  const isPublishAction = body.status === "published";

  if (isReviewAction && !canReviewLesson(access, lesson)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.status === "in_review" && !isOwner) {
    return NextResponse.json({ error: "Only owner can request review" }, { status: 403 });
  }

  if (isPublishAction && !isOwner && !access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Only owner or manager can publish lesson" }, { status: 403 });
  }

  if (body.reviewer_id && !isOwner && !access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Only owner can assign reviewer" }, { status: 403 });
  }

  if (body.package && !isOwner && !access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Only owner can update lesson package" }, { status: 403 });
  }

  if ((body.title !== undefined || body.project_id !== undefined) && !isOwner && !access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Only owner can update lesson metadata" }, { status: 403 });
  }

  if (body.reviewer_id) {
    const { data: reviewer } = await (serviceSupabase as any)
      .from("profiles")
      .select("id, role")
      .eq("id", body.reviewer_id)
      .single();

    if (!reviewer || !["admin", "lead_teacher", "reviewer"].includes(reviewer.role)) {
      return NextResponse.json({ error: "Invalid reviewer" }, { status: 400 });
    }
  }

  if (body.status === "in_review" && !body.reviewer_id && !lesson.reviewer_id) {
    const recommendedReviewerId = await resolveRecommendedReviewerId(serviceSupabase as Awaited<ReturnType<typeof createClient>>);
    if (!recommendedReviewerId) {
      return NextResponse.json(
        { error: "검토 요청을 처리할 검토자가 없습니다. 검토자 계정을 먼저 설정해 주세요." },
        { status: 400 }
      );
    }
    patch.reviewer_id = recommendedReviewerId;
  }

  if (body.status === "approved") {
    patch.reviewed_at = new Date().toISOString();
    patch.review_notes = body.review_notes ?? null;
  }

  if (body.status === "needs_revision") {
    patch.reviewed_at = new Date().toISOString();
  }

  if (body.status === "published" && lesson.status !== "approved") {
    return NextResponse.json({ error: "승인된 레슨만 발행 완료로 변경할 수 있습니다." }, { status: 400 });
  }

  if (body.status === "published") {
    patch.review_notes = body.review_notes ?? null;
  }

  if (body.package) {
    patch.package = body.package;
  }

  if (body.title !== undefined) {
    const nextTitle = body.title.trim();
    if (!nextTitle) {
      return NextResponse.json({ error: "레슨 제목은 비워둘 수 없습니다." }, { status: 400 });
    }
    patch.title = nextTitle;
  }

  if (body.project_id !== undefined) {
    if (body.project_id) {
      const allowedOwnerIds = Array.from(new Set([user.id, lesson.user_id].filter(Boolean)));
      const { data: project } = await (serviceSupabase as any)
        .from("projects")
        .select("id, user_id, name")
        .eq("id", body.project_id)
        .in("user_id", allowedOwnerIds)
        .maybeSingle();

      if (!project) {
        return NextResponse.json(
          { error: "배정할 수 없는 프로젝트입니다. 프로젝트 목록을 새로고침한 뒤 다시 시도해 주세요." },
          { status: 400 }
        );
      }
    }
    patch.project_id = body.project_id ?? null;
  }

  const { error } = await (serviceSupabase as any)
    .from("lessons")
    .update(patch)
    .eq("id", id)
    .select("id");

  if (error) {
    const message = String(error.message ?? "");
    if (
      message.includes("Cannot coerce the result to a single JSON object") ||
      message.toLowerCase().includes("single json object")
    ) {
      return NextResponse.json(
        { error: "레슨 상태를 변경하지 못했습니다. 권한 또는 현재 상태를 다시 확인해 주세요." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = await (serviceSupabase as any)
    .from("lessons")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    return NextResponse.json(
      { error: "레슨 상태를 변경하지 못했습니다. 권한 또는 현재 상태를 다시 확인해 주세요." },
      { status: 403 }
    );
  }

  const nextReviewerId =
    typeof patch.reviewer_id === "string"
      ? patch.reviewer_id
      : body.reviewer_id ?? lesson.reviewer_id ?? null;

  if (nextReviewerId && nextReviewerId !== lesson.reviewer_id) {
    await logLessonActivity(serviceSupabase as any, {
      lessonId: id,
      actorId: user.id,
      action: "reviewer_assigned",
      metadata: {
        reviewer_id: nextReviewerId,
        previous_reviewer_id: lesson.reviewer_id ?? null,
        note:
          body.reviewer_reason ??
          (body.status === "in_review" && !body.reviewer_id
            ? "검토 요청 시 추천 검토자로 자동 배정"
            : null),
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
            : body.status === "published"
              ? "published"
            : "status_changed";

    await logLessonActivity(serviceSupabase as any, {
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

  if (body.package) {
    await logLessonActivity(serviceSupabase as any, {
      lessonId: id,
      actorId: user.id,
      action: "package_updated",
      metadata: {
        note: "레슨 패키지 내용이 업데이트되었습니다.",
      },
    });
  }

  if (body.title !== undefined && body.title.trim() !== lesson.title) {
    await logLessonActivity(serviceSupabase as any, {
      lessonId: id,
      actorId: user.id,
      action: "title_renamed",
      metadata: {
        previous_title: lesson.title,
        next_title: body.title.trim(),
      },
    });
  }

  if (body.project_id !== undefined && body.project_id !== lesson.project_id) {
    await logLessonActivity(serviceSupabase as any, {
      lessonId: id,
      actorId: user.id,
      action: body.project_id ? "project_assigned" : "project_unassigned",
      metadata: {
        previous_project_id: lesson.project_id ?? null,
        next_project_id: body.project_id ?? null,
      },
    });
  }

  return NextResponse.json({ lesson: data });
}
