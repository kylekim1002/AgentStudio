import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LessonPackage, AIProvider } from "@/lib/agents/types";
import { LessonStatus } from "@/lib/collab/lesson";
import { getViewerAccess } from "@/lib/authz/server";
import { logLessonActivity } from "@/lib/collab/activity";
import { DEFAULT_REVIEW_SLA_HOURS, normalizeReviewSlaHours } from "@/lib/reviewSettings";

const REVIEWER_ROLES = ["admin", "lead_teacher", "reviewer"];

function getHoursDiff(from: string, to: Date) {
  return Math.max(
    0,
    Math.round(((to.getTime() - new Date(from).getTime()) / (1000 * 60 * 60)) * 10) / 10
  );
}

async function resolveRecommendedReviewerId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: reviewerProfiles } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("role", REVIEWER_ROLES)
    .order("name", { ascending: true });

  const reviewerIds = (reviewerProfiles ?? []).map((profile) => profile.id);
  if (reviewerIds.length === 0) return null;

  const { data: slaRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "review_sla_hours")
    .maybeSingle();

  const reviewSlaHours = normalizeReviewSlaHours(
    slaRow?.value ?? DEFAULT_REVIEW_SLA_HOURS
  );

  const { data: queueRows } = await supabase
    .from("lessons")
    .select("reviewer_id, submitted_at")
    .in("reviewer_id", reviewerIds)
    .eq("status", "in_review");

  const now = new Date();
  const queueMap = new Map<string, number[]>();
  for (const row of queueRows ?? []) {
    if (!row.reviewer_id || !row.submitted_at) continue;
    const hours = getHoursDiff(row.submitted_at, now);
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
      const overdueCount = rows.filter((hour) => hour >= reviewSlaHours).length;

      return {
        id: profile.id,
        queueCount,
        averageWaitHours,
        overdueCount,
        name: profile.name ?? "이름 미지정",
      };
    })
    .sort((a, b) => {
      if (a.overdueCount !== b.overdueCount) return a.overdueCount - b.overdueCount;
      if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
      if (a.averageWaitHours !== b.averageWaitHours) return a.averageWaitHours - b.averageWaitHours;
      return a.name.localeCompare(b.name, "ko");
    });

  return sorted[0]?.id ?? null;
}

// GET /api/lessons — 내 레슨 목록 (project_id, search 필터 지원)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const search    = searchParams.get("search");
  const favOnly   = searchParams.get("favorite") === "true";
  const scope     = searchParams.get("scope") ?? "all";
  const status    = searchParams.get("status");
  const reassigned = searchParams.get("reassigned");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("lessons")
    .select("id, user_id, title, difficulty, provider, status, reviewer_id, review_notes, created_at, submitted_at, reviewed_at, project_id, tags, favorites(id)")
    .order("created_at", { ascending: false });

  if (!access.features.includes("approval.manage")) {
    query = query.eq("user_id", user.id);
  } else if (scope === "mine") {
    query = query.eq("user_id", user.id);
  } else if (scope === "review") {
    query = query.eq("reviewer_id", user.id);
  }

  if (projectId) query = query.eq("project_id", projectId);
  if (search)    query = query.ilike("title", `%${search}%`);
  if (
    status &&
    ["draft", "in_review", "needs_revision", "approved", "published"].includes(status)
  ) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileIds = Array.from(
    new Set(
      ((data as Array<{ user_id?: string; reviewer_id?: string | null }> | null) ?? [])
        .flatMap((lesson) => [lesson.user_id, lesson.reviewer_id])
        .filter(Boolean)
    )
  );

  const { data: profiles } = profileIds.length
    ? await supabase
        .from("profiles")
        .select("id, name, role")
        .in("id", profileIds)
    : { data: [] as Array<{ id: string; name: string | null; role: string }> };

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lessons = (data as any[]).map((l) => ({
    ...l,
    isFavorite: Array.isArray(l.favorites) && l.favorites.length > 0,
    owner_name: l.user_id ? profileMap.get(l.user_id)?.name ?? null : null,
    reviewer_name: l.reviewer_id ? profileMap.get(l.reviewer_id)?.name ?? null : null,
    favorites: undefined,
  }));

  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const reassignmentLastSeenAt =
    typeof settings.reassignmentAlertsLastSeenAt === "string"
      ? settings.reassignmentAlertsLastSeenAt
      : null;
  const reassignmentSince =
    reassignmentLastSeenAt ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();

  const lessonIds = lessons.map((lesson) => lesson.id);
  const { data: reassignmentActivities } = lessonIds.length
    ? await (supabase as any)
        .from("lesson_activities")
        .select("lesson_id, metadata, created_at")
        .eq("action", "reviewer_assigned")
        .in("lesson_id", lessonIds)
        .gte("created_at", reassignmentSince)
    : { data: [] };

  const reassignmentBadgeMap = new Map<string, "to_me" | "from_me">();
  for (const activity of (reassignmentActivities ?? []) as Array<{
    lesson_id?: string | null;
    metadata?: {
      reviewer_id?: string | null;
      previous_reviewer_id?: string | null;
    } | null;
  }>) {
    if (!activity.lesson_id) continue;
    if (activity.metadata?.reviewer_id === user.id) {
      reassignmentBadgeMap.set(activity.lesson_id, "to_me");
      continue;
    }
    if (!reassignmentBadgeMap.has(activity.lesson_id) && activity.metadata?.previous_reviewer_id === user.id) {
      reassignmentBadgeMap.set(activity.lesson_id, "from_me");
    }
  }

  lessons = lessons.map((lesson) => ({
    ...lesson,
    reassigned_badge: reassignmentBadgeMap.get(lesson.id) ?? null,
  }));

  if (reassigned === "to_me" || reassigned === "from_me") {
    lessons = lessons.filter((lesson) => lesson.reassigned_badge === reassigned);
  }

  if (favOnly) lessons = lessons.filter((l) => l.isFavorite);

  return NextResponse.json({ lessons });
}

// POST /api/lessons — 레슨 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);

  let body: {
    package: LessonPackage;
    provider: AIProvider;
    project_id?: string;
    tags?: string[];
    status?: LessonStatus;
    reviewer_id?: string | null;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { package: lessonPackage, provider, project_id, tags, status, reviewer_id } = body;

  let resolvedReviewerId: string | null = null;
  if (reviewer_id) {
    const { data: reviewer } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", reviewer_id)
      .single();

    if (!reviewer || !["admin", "lead_teacher", "reviewer"].includes(reviewer.role)) {
      return NextResponse.json({ error: "Invalid reviewer" }, { status: 400 });
    }

    resolvedReviewerId = reviewer.id;
  }

  if (!resolvedReviewerId && status === "in_review") {
    resolvedReviewerId = await resolveRecommendedReviewerId(supabase);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("lessons")
    .insert({
      user_id: user.id,
      title: lessonPackage.title,
      difficulty: lessonPackage.difficulty,
      provider,
      status: status ?? "draft",
      reviewer_id: status === "in_review" ? resolvedReviewerId : null,
      submitted_at: status === "in_review" ? new Date().toISOString() : null,
      package: lessonPackage,
      project_id: project_id ?? null,
      tags: tags ?? [],
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logLessonActivity(supabase, {
    lessonId: (data as { id: string }).id,
    actorId: user.id,
    action: "created",
    metadata: {
      status: status ?? "draft",
      reviewer_id: resolvedReviewerId,
    },
  });

  if ((status ?? "draft") === "in_review") {
    await logLessonActivity(supabase, {
      lessonId: (data as { id: string }).id,
      actorId: user.id,
      action: "submitted_for_review",
      metadata: {
        to_status: "in_review",
        reviewer_id: resolvedReviewerId,
      },
    });

    if (resolvedReviewerId) {
      await logLessonActivity(supabase, {
        lessonId: (data as { id: string }).id,
        actorId: user.id,
        action: "reviewer_assigned",
        metadata: {
          reviewer_id: resolvedReviewerId,
          note: reviewer_id ? "검토 요청 시 수동 지정" : "검토 요청 시 추천 검토자로 자동 배정",
        },
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ id: (data as any).id }, { status: 201 });
}
