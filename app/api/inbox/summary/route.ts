import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
const REVIEWER_ROLES = ["admin", "lead_teacher", "reviewer"];
import { DEFAULT_REVIEW_SLA_HOURS, normalizeReviewSlaHours } from "@/lib/reviewSettings";

function getHoursDiff(from: string, to: Date) {
  return Math.max(
    0,
    Math.round(((to.getTime() - new Date(from).getTime()) / (1000 * 60 * 60)) * 10) / 10
  );
}

interface ReassignmentActivityRow {
  lesson_id?: string | null;
  created_at: string;
  metadata?: {
    reviewer_id?: string | null;
    previous_reviewer_id?: string | null;
    note?: string | null;
  } | null;
}

function compareReviewerLoad(
  a: { overdueCount: number; queueCount: number; averageWaitHours: number; name: string },
  b: { overdueCount: number; queueCount: number; averageWaitHours: number; name: string }
) {
  if (a.overdueCount !== b.overdueCount) return a.overdueCount - b.overdueCount;
  if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
  if (a.averageWaitHours !== b.averageWaitHours) return a.averageWaitHours - b.averageWaitHours;
  return a.name.localeCompare(b.name, "ko");
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const { data: mine, error: mineError } = await supabase
    .from("lessons")
    .select("status, submitted_at")
    .eq("user_id", user.id);

  if (mineError) {
    return NextResponse.json({ error: mineError.message }, { status: 500 });
  }

  const canReview = access.features.includes("approval.manage");
  const { data: reviewQueue, error: reviewError } = canReview
    ? await supabase
        .from("lessons")
        .select("status, submitted_at")
        .eq("reviewer_id", user.id)
        .eq("status", "in_review")
    : { data: [], error: null };

  if (reviewError) {
    return NextResponse.json({ error: reviewError.message }, { status: 500 });
  }

  const { data: reviewers, error: reviewersError } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("role", REVIEWER_ROLES)
    .order("name", { ascending: true });

  if (reviewersError) {
    return NextResponse.json({ error: reviewersError.message }, { status: 500 });
  }

  const { data: slaRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "review_sla_hours")
    .maybeSingle();

  const reviewSlaHours = normalizeReviewSlaHours(
    slaRow?.value ?? DEFAULT_REVIEW_SLA_HOURS
  );
  const reassignmentLastSeenAt = (() => {
    const settings = (profile?.settings ?? {}) as Record<string, unknown>;
    return typeof settings.reassignmentAlertsLastSeenAt === "string"
      ? settings.reassignmentAlertsLastSeenAt
      : null;
  })();

  const reviewerIds = (reviewers ?? []).map((profile) => profile.id);
  const { data: reviewerLessons, error: reviewerQueueError } =
    reviewerIds.length > 0
      ? await supabase
          .from("lessons")
          .select("id, title, reviewer_id, submitted_at")
          .in("reviewer_id", reviewerIds)
          .eq("status", "in_review")
      : { data: [], error: null };

  if (reviewerQueueError) {
    return NextResponse.json({ error: reviewerQueueError.message }, { status: 500 });
  }

  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
  const { data: reassignmentActivities, error: reassignmentError } = await (supabase as any)
    .from("lesson_activities")
    .select("lesson_id, metadata, created_at")
    .eq("action", "reviewer_assigned")
    .gte("created_at", since);

  if (reassignmentError) {
    return NextResponse.json({ error: reassignmentError.message }, { status: 500 });
  }

  const mineRows = mine ?? [];
  const reviewRows = reviewQueue ?? [];
  const now = new Date();
  const myInReviewRows = mineRows.filter((lesson) => lesson.status === "in_review" && lesson.submitted_at);
  const reviewQueueRows = reviewRows.filter((lesson) => lesson.status === "in_review" && lesson.submitted_at);
  const reviewerGroupedRows = (reviewerLessons ?? []).reduce<Record<string, number[]>>((acc, row) => {
    if (!row.reviewer_id || !row.submitted_at) return acc;
    const hours = getHoursDiff(row.submitted_at, now);
    acc[row.reviewer_id] = [...(acc[row.reviewer_id] ?? []), hours];
    return acc;
  }, {});

  const myPendingHours = myInReviewRows.map((lesson) => getHoursDiff(lesson.submitted_at as string, now));
  const reviewPendingHours = reviewQueueRows.map((lesson) => getHoursDiff(lesson.submitted_at as string, now));

  const averageReviewWaitHours =
    reviewPendingHours.length > 0
      ? Math.round((reviewPendingHours.reduce((sum, hour) => sum + hour, 0) / reviewPendingHours.length) * 10) / 10
      : 0;
  const maxReviewWaitHours =
    reviewPendingHours.length > 0 ? Math.max(...reviewPendingHours) : 0;
  const overdueReviewCount = reviewPendingHours.filter((hour) => hour >= reviewSlaHours).length;
  const myAverageWaitHours =
    myPendingHours.length > 0
      ? Math.round((myPendingHours.reduce((sum, hour) => sum + hour, 0) / myPendingHours.length) * 10) / 10
      : 0;
  const unreadReassignmentActivities = ((reassignmentActivities ?? []) as ReassignmentActivityRow[]).filter(
    (activity) =>
      !reassignmentLastSeenAt || activity.created_at > reassignmentLastSeenAt
  );
  const reassignmentLessonIds = Array.from(
    new Set(
      unreadReassignmentActivities
        .map((activity: { lesson_id?: string | null }) => activity.lesson_id)
        .filter(Boolean)
    )
  );
  const { data: reassignmentLessons } = reassignmentLessonIds.length
    ? await supabase
        .from("lessons")
        .select("id, title")
        .in("id", reassignmentLessonIds)
    : { data: [] as Array<{ id: string; title: string | null }> };
  const reassignmentLessonMap = new Map(
    (reassignmentLessons ?? []).map((lesson) => [lesson.id, lesson.title ?? "제목 없음"])
  );
  const reviewerMap = new Map(
    (reviewers ?? []).map((profile) => [profile.id, profile.name ?? "이름 미지정"])
  );
  const reassignedToMeCount = unreadReassignmentActivities.filter((activity: { metadata?: { reviewer_id?: string | null } | null }) => {
    return activity.metadata?.reviewer_id === user.id;
  }).length;
  const reassignedFromMeCount = unreadReassignmentActivities.filter((activity: { metadata?: { previous_reviewer_id?: string | null } | null }) => {
    return activity.metadata?.previous_reviewer_id === user.id;
  }).length;

  const reviewerWorkload = (reviewers ?? [])
    .map((profile) => {
      const rows = reviewerGroupedRows[profile.id] ?? [];
      const queueCount = rows.length;
      const averageWaitHours =
        queueCount > 0
          ? Math.round((rows.reduce((sum, hour) => sum + hour, 0) / queueCount) * 10) / 10
          : 0;
      const maxWaitHours = queueCount > 0 ? Math.max(...rows) : 0;
      const overdueCount = rows.filter((hour) => hour >= reviewSlaHours).length;

      return {
        id: profile.id,
        name: profile.name ?? "이름 미지정",
        role: profile.role,
        queueCount,
        averageWaitHours,
        maxWaitHours,
        overdueCount,
      };
    })
    .sort(compareReviewerLoad);

  return NextResponse.json({
    summary: {
      myDrafts: mineRows.filter((lesson) => lesson.status === "draft").length,
      myNeedsRevision: mineRows.filter((lesson) => lesson.status === "needs_revision").length,
      myInReview: mineRows.filter((lesson) => lesson.status === "in_review").length,
      myApproved: mineRows.filter((lesson) => lesson.status === "approved" || lesson.status === "published").length,
      reviewQueue: reviewRows.length,
      myAverageWaitHours,
      averageReviewWaitHours,
      maxReviewWaitHours,
      overdueReviewCount,
      reviewSlaHours,
      reassignedToMeCount,
      reassignedFromMeCount,
      inboxTotal:
        mineRows.filter((lesson) => lesson.status === "needs_revision").length +
        reviewRows.length,
    },
    reviewers: reviewerWorkload.map((reviewer, index) => ({
      id: reviewer.id,
      name: reviewer.name,
      role: reviewer.role,
      queueCount: reviewer.queueCount,
      averageWaitHours: reviewer.averageWaitHours,
      overdueCount: reviewer.overdueCount,
      isRecommended: index === 0,
      recommendationReason:
        index === 0
          ? reviewer.overdueCount > 0
            ? `현재 가장 안정적인 후보입니다. 대기 ${reviewer.queueCount}건, 평균 ${reviewer.averageWaitHours}시간, SLA 초과 ${reviewer.overdueCount}건입니다.`
            : `현재 가장 여유 있는 검토자입니다. 대기 ${reviewer.queueCount}건, 평균 ${reviewer.averageWaitHours}시간입니다.`
          : undefined,
    })),
    reviewerBoard: reviewerWorkload.map((reviewer) => {
      const queueItems = (reviewerLessons ?? [])
        .filter((lesson) => lesson.reviewer_id === reviewer.id && lesson.submitted_at)
        .map((lesson) => ({
          id: lesson.id,
          title: lesson.title ?? "제목 없음",
          submitted_at: lesson.submitted_at,
          waitHours: getHoursDiff(lesson.submitted_at, now),
        }))
        .sort((a, b) => b.waitHours - a.waitHours)
        .slice(0, 3);

      return {
        id: reviewer.id,
        name: reviewer.name,
        role: reviewer.role,
        queueCount: reviewer.queueCount,
        averageWaitHours: reviewer.averageWaitHours,
        maxWaitHours: reviewer.maxWaitHours,
        overdueCount: reviewer.overdueCount,
        queueItems,
      };
    }),
    reassignmentItems: {
      toMe: unreadReassignmentActivities
        .filter((activity) => activity.metadata?.reviewer_id === user.id)
        .map((activity) => ({
          lessonId: activity.lesson_id,
          lessonTitle: activity.lesson_id ? reassignmentLessonMap.get(activity.lesson_id) ?? "제목 없음" : "제목 없음",
          counterpartyName: activity.metadata?.previous_reviewer_id
            ? reviewerMap.get(activity.metadata.previous_reviewer_id) ?? "이전 검토자"
            : "미배정",
          reason: activity.metadata?.note ?? null,
          createdAt: activity.created_at,
        }))
        .sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
      fromMe: unreadReassignmentActivities
        .filter((activity) => activity.metadata?.previous_reviewer_id === user.id)
        .map((activity) => ({
          lessonId: activity.lesson_id,
          lessonTitle: activity.lesson_id ? reassignmentLessonMap.get(activity.lesson_id) ?? "제목 없음" : "제목 없음",
          counterpartyName: activity.metadata?.reviewer_id
            ? reviewerMap.get(activity.metadata.reviewer_id) ?? "새 검토자"
            : "미배정",
          reason: activity.metadata?.note ?? null,
          createdAt: activity.created_at,
        }))
        .sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
    },
  });
}
