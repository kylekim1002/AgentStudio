import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { DEFAULT_REVIEW_SLA_HOURS, normalizeReviewSlaHours } from "@/lib/reviewSettings";

const REVIEWER_ROLES = ["admin", "lead_teacher", "reviewer"];

function getHoursDiff(from: string, to: Date) {
  return Math.max(
    0,
    Math.round(((to.getTime() - new Date(from).getTime()) / (1000 * 60 * 60)) * 10) / 10
  );
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
  if (!access.features.includes("library.access")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("role", REVIEWER_ROLES)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: slaRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "review_sla_hours")
    .maybeSingle();

  const reviewSlaHours = normalizeReviewSlaHours(
    slaRow?.value ?? DEFAULT_REVIEW_SLA_HOURS
  );
  const reviewerIds = (data ?? []).map((profile) => profile.id);
  const { data: queueRows } = reviewerIds.length
    ? await supabase
        .from("lessons")
        .select("reviewer_id, submitted_at")
        .in("reviewer_id", reviewerIds)
        .eq("status", "in_review")
    : { data: [] as Array<{ reviewer_id: string; submitted_at: string | null }> };

  const now = new Date();
  const queueMap = new Map<string, number[]>();
  for (const row of queueRows ?? []) {
    if (!row.reviewer_id || !row.submitted_at) continue;
    const hours = getHoursDiff(row.submitted_at, now);
    queueMap.set(row.reviewer_id, [...(queueMap.get(row.reviewer_id) ?? []), hours]);
  }

  const reviewers = (data ?? [])
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
        name: profile.name ?? "이름 미지정",
        role: profile.role,
        queueCount,
        averageWaitHours,
        overdueCount,
      };
    })
    .sort((a, b) => {
      if (a.overdueCount !== b.overdueCount) return a.overdueCount - b.overdueCount;
      if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
      if (a.averageWaitHours !== b.averageWaitHours) return a.averageWaitHours - b.averageWaitHours;
      return a.name.localeCompare(b.name, "ko");
    })
    .map((reviewer, index) => ({
      ...reviewer,
      isRecommended: index === 0,
      recommendationReason:
        index === 0
          ? reviewer.overdueCount > 0
            ? `현재 가장 안정적인 후보입니다. 대기 ${reviewer.queueCount}건, 평균 ${reviewer.averageWaitHours}시간, SLA 초과 ${reviewer.overdueCount}건입니다.`
            : `현재 가장 여유 있는 검토자입니다. 대기 ${reviewer.queueCount}건, 평균 ${reviewer.averageWaitHours}시간입니다.`
          : undefined,
    }));

  return NextResponse.json({ reviewers });
}
