"use client";

import Link from "next/link";
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { AppRole } from "@/lib/authz/roles";
import { dispatchInboxSync, subscribeInboxSync } from "@/lib/ui/inboxSync";

interface WorkInboxSummary {
  myDrafts: number;
  myNeedsRevision: number;
  myInReview: number;
  myApproved: number;
  reviewQueue: number;
  myAverageWaitHours: number;
  averageReviewWaitHours: number;
  maxReviewWaitHours: number;
  overdueReviewCount: number;
  reviewSlaHours: number;
  reassignedToMeCount: number;
  reassignedFromMeCount: number;
  inboxTotal: number;
}

interface WorkInboxClientProps {
  viewerRole: AppRole;
  canManageReview: boolean;
}

interface ReviewerBoardItem {
  id: string;
  name: string;
  role: string;
  queueCount: number;
  averageWaitHours: number;
  maxWaitHours: number;
  overdueCount: number;
  queueItems: {
    id: string;
    title: string;
    submitted_at: string;
    waitHours: number;
  }[];
}

interface WorkCardData {
  title: string;
  value: number;
  description: string;
  href: string;
  query: string;
  tone: "neutral" | "warning" | "review" | "success";
  meta?: string;
}

interface ReviewerOption {
  id: string;
  name: string;
  role: string;
  queueCount: number;
  averageWaitHours: number;
  overdueCount: number;
  isRecommended?: boolean;
  recommendationReason?: string;
}

interface ReassignmentItem {
  lessonId: string | null;
  lessonTitle: string;
  counterpartyName: string;
  reason: string | null;
  createdAt: string;
}

const EMPTY_SUMMARY: WorkInboxSummary = {
  myDrafts: 0,
  myNeedsRevision: 0,
  myInReview: 0,
  myApproved: 0,
  reviewQueue: 0,
  myAverageWaitHours: 0,
  averageReviewWaitHours: 0,
  maxReviewWaitHours: 0,
  overdueReviewCount: 0,
  reviewSlaHours: 24,
  reassignedToMeCount: 0,
  reassignedFromMeCount: 0,
  inboxTotal: 0,
};

export default function WorkInboxClient({
  viewerRole,
  canManageReview,
}: WorkInboxClientProps) {
  const [summary, setSummary] = useState<WorkInboxSummary>(EMPTY_SUMMARY);
  const [reviewerBoard, setReviewerBoard] = useState<ReviewerBoardItem[]>([]);
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);
  const [reassignmentItems, setReassignmentItems] = useState<{
    toMe: ReassignmentItem[];
    fromMe: ReassignmentItem[];
  }>({ toMe: [], fromMe: [] });
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [reassigningLessonId, setReassigningLessonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  async function loadSummary(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch("/api/inbox/summary", { cache: "no-store" });
      if (!res.ok) {
        if (!isMountedRef.current) return;
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
        return;
      }

      const data = await res.json();
      if (!isMountedRef.current) return;
      setSummary(data.summary ?? EMPTY_SUMMARY);
      setReviewerBoard(Array.isArray(data.reviewerBoard) ? data.reviewerBoard : []);
      setReviewers(Array.isArray(data.reviewers) ? data.reviewers : []);
      setReassignmentItems({
        toMe: Array.isArray(data.reassignmentItems?.toMe) ? data.reassignmentItems.toMe : [],
        fromMe: Array.isArray(data.reassignmentItems?.fromMe) ? data.reassignmentItems.fromMe : [],
      });
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      if (!isMountedRef.current) return;
    } finally {
      if (!isMountedRef.current) return;
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    isMountedRef.current = true;
    void loadSummary();

    const intervalId = window.setInterval(() => {
      if (cancelled || document.hidden) return;
      void loadSummary({ silent: true });
    }, 60000);

    function handleInboxSync() {
      if (cancelled) return;
      void loadSummary({ silent: true });
    }

    const unsubscribe = subscribeInboxSync(handleInboxSync);

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, []);

  async function reloadSummary() {
    await loadSummary();
  }

  async function acknowledgeReassignmentAlerts() {
    setActionError(null);
    try {
      const res = await fetch("/api/inbox/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reassignment" }),
      });
      if (!res.ok) {
        setActionError("재배정 알림 읽음 처리 중 오류가 발생했습니다.");
        return;
      }
      dispatchInboxSync("lesson_reassigned");
      await reloadSummary();
    } catch {
      setActionError("재배정 알림 읽음 처리 중 오류가 발생했습니다.");
    }
  }

  async function reassignLesson(lessonId: string, nextReviewerId: string) {
    if (!nextReviewerId) return;
    const reason = window.prompt("재배정 사유를 남겨주세요.", "SLA 초과로 재배정");
    if (reason === null) return;
    setReassigningLessonId(lessonId);
    setActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer_id: nextReviewerId,
          reviewer_reason: reason.trim() || "재배정 사유 미입력",
        }),
      });
      if (!res.ok) {
        setActionError("검토 재배정 중 오류가 발생했습니다.");
        return;
      }
      dispatchInboxSync("lesson_reassigned");
      await reloadSummary();
    } catch {
      setActionError("검토 재배정 중 오류가 발생했습니다.");
    } finally {
      setReassigningLessonId(null);
    }
  }

  const roleLabel =
    viewerRole === "admin"
      ? "관리자"
      : viewerRole === "lead_teacher"
        ? "수석 강사"
        : viewerRole === "reviewer"
          ? "검토자"
          : "강사";

  const heroCopy = useMemo(() => {
    if (viewerRole === "teacher") {
      return {
        title: "오늘 수정하거나 넘겨야 할 레슨을 빠르게 정리하세요",
        description:
          "강사 화면은 복잡한 운영 정보보다 내 수업 준비 흐름이 먼저 보여야 합니다. 초안, 수정 필요, 검토 대기 상태를 중심으로 바로 움직일 수 있게 구성했습니다.",
        focusTitle: "지금 가장 먼저 볼 것",
        focusBody:
          summary.myNeedsRevision > 0
            ? `수정 필요 ${summary.myNeedsRevision}건이 있습니다. 검토 메모를 반영한 뒤 다시 검토 요청으로 넘기는 게 우선입니다.`
            : summary.myDrafts > 0
              ? `초안 ${summary.myDrafts}건이 남아 있습니다. 오늘 넘길 레슨이 있다면 검토 요청으로 바꿔주세요.`
              : summary.myInReview > 0
                ? `검토중 ${summary.myInReview}건의 평균 대기 시간은 ${summary.myAverageWaitHours}시간입니다. 오래 걸리는 건은 코멘트 링크로 맥락을 다시 남겨도 좋습니다.`
                : "당장 수정할 레슨은 없습니다. 새 레슨 생성이나 승인된 자료 정리에 집중하면 됩니다.",
      };
    }

    if (viewerRole === "reviewer") {
      return {
        title: "검토 큐를 비우는 것이 오늘의 가장 큰 업무입니다",
        description:
          "검토자가 멈추면 작성자 작업도 같이 멈춥니다. 검토함 중심으로 승인 또는 수정 요청을 빠르게 남기도록 화면 우선순위를 조정했습니다.",
        focusTitle: "지금 가장 먼저 볼 것",
        focusBody:
          summary.reviewQueue > 0
            ? `검토 대기 ${summary.reviewQueue}건이 있습니다. 평균 ${summary.averageReviewWaitHours}시간, 최장 ${summary.maxReviewWaitHours}시간 대기 중이며 ${summary.reviewSlaHours}시간 초과가 ${summary.overdueReviewCount}건입니다.`
            : "현재 내 검토함은 비어 있습니다. 필요한 경우 자료실에서 승인 완료 자료나 코멘트를 확인하면 됩니다.",
      };
    }

    return {
      title: "작성과 검토 흐름을 함께 관리하세요",
      description:
        "수석 강사와 관리자는 내 작업과 검토 큐를 함께 봐야 합니다. 병목이 생기는 구간을 먼저 정리하고 팀 흐름을 매끄럽게 유지하는 데 집중하면 됩니다.",
      focusTitle: "지금 가장 먼저 볼 것",
      focusBody:
        summary.reviewQueue > 0
          ? `내 검토함 ${summary.reviewQueue}건이 먼저 보입니다. 평균 ${summary.averageReviewWaitHours}시간 대기 중이고 ${summary.overdueReviewCount}건은 SLA를 넘겼습니다.`
          : summary.myNeedsRevision > 0
            ? `수정 필요 ${summary.myNeedsRevision}건이 있습니다. 팀 피드백 루프를 닫기 위해 먼저 정리해 주세요.`
            : "급한 병목은 보이지 않습니다. 새 요청 배정이나 승인 완료 자료 점검에 시간을 쓰기 좋습니다.",
    };
  }, [summary.averageReviewWaitHours, summary.maxReviewWaitHours, summary.myAverageWaitHours, summary.myDrafts, summary.myInReview, summary.myNeedsRevision, summary.overdueReviewCount, summary.reviewQueue, summary.reviewSlaHours, viewerRole]);

  const cards: WorkCardData[] = [
    {
      title: "내 초안",
      value: summary.myDrafts,
      description: "아직 검토 요청 전인 레슨",
      href: "/library",
      query: canManageReview ? "?scope=mine&status=draft" : "?status=draft",
      tone: "neutral" as const,
    },
    {
      title: "수정 필요",
      value: summary.myNeedsRevision,
      description: "피드백을 반영해야 하는 레슨",
      href: "/library",
      query: canManageReview ? "?scope=mine&status=needs_revision" : "?status=needs_revision",
      tone: "warning" as const,
    },
    {
      title: "검토 대기",
      value: summary.myInReview,
      description: "검토자가 확인 중인 레슨",
      href: "/library",
      query: canManageReview ? "?scope=mine&status=in_review" : "?status=in_review",
      tone: "review" as const,
      meta: summary.myInReview > 0 ? `평균 ${summary.myAverageWaitHours}시간` : undefined,
    },
    {
      title: "완료",
      value: summary.myApproved,
      description: "승인 또는 발행 완료",
      href: "/library",
      query: canManageReview ? "?scope=mine&status=approved" : "?status=approved",
      tone: "success" as const,
    },
    ...(canManageReview
      ? [
          {
            title: "내 검토함",
            value: summary.reviewQueue,
            description: "지금 내가 검토해야 하는 레슨",
            href: "/library",
            query: "?scope=review&status=in_review",
            tone: "review" as const,
            meta:
              summary.reviewQueue > 0
                ? `최장 ${summary.maxReviewWaitHours}시간 · 초과 ${summary.overdueReviewCount}건`
                : undefined,
          },
        ]
      : []),
  ];

  const prioritizedCards = useMemo(() => {
    const isCard = (card: WorkCardData | undefined): card is WorkCardData => Boolean(card);

    if (viewerRole === "teacher") {
      return [
        cards.find((card) => card.title === "수정 필요"),
        cards.find((card) => card.title === "내 초안"),
        cards.find((card) => card.title === "검토 대기"),
        cards.find((card) => card.title === "완료"),
      ].filter(isCard);
    }

    if (viewerRole === "reviewer") {
      return [
        cards.find((card) => card.title === "내 검토함"),
        cards.find((card) => card.title === "완료"),
        cards.find((card) => card.title === "검토 대기"),
        cards.find((card) => card.title === "수정 필요"),
      ].filter(isCard);
    }

    return [
      cards.find((card) => card.title === "내 검토함"),
      cards.find((card) => card.title === "수정 필요"),
      cards.find((card) => card.title === "내 초안"),
      cards.find((card) => card.title === "검토 대기"),
      cards.find((card) => card.title === "완료"),
    ].filter(isCard);
  }, [cards, viewerRole]);

  const quickActions = useMemo(() => {
    if (viewerRole === "teacher") {
      return [
        {
          title: "새 레슨 생성",
          description: "새로운 수업 자료를 만들고 초안 또는 검토 요청으로 저장합니다.",
          href: "/studio",
          actionLabel: "스튜디오 열기",
        },
        {
          title: "수정 필요 레슨 정리",
          description: "검토 메모를 반영해야 하는 레슨을 우선적으로 모아 봅니다.",
          href: "/library?status=needs_revision",
          actionLabel: "자료실 보기",
        },
      ];
    }

    if (viewerRole === "reviewer") {
      return [
        {
          title: "검토함 처리",
          description: "내게 배정된 검토 요청을 확인하고 승인 또는 수정 요청을 남깁니다.",
          href: "/library?scope=review&status=in_review",
          actionLabel: "검토함 열기",
        },
        {
          title: "전체 자료 확인",
          description: "팀이 만든 레슨을 전체 기준으로 훑어보며 상태를 파악합니다.",
          href: "/library?scope=all&status=in_review",
          actionLabel: "전체 자료 보기",
        },
      ];
    }

    return [
      {
        title: "검토함 처리",
        description: "내게 배정된 검토 요청을 먼저 정리해 병목을 줄입니다.",
        href: "/library?scope=review&status=in_review",
        actionLabel: "검토함 열기",
      },
      {
        title: "내 작업 정리",
        description: "초안, 수정 필요, 승인된 레슨을 자료실에서 계속 관리합니다.",
        href: "/library?scope=mine&status=needs_revision",
        actionLabel: "내 작업 보기",
      },
      {
        title: "새 레슨 생성",
        description: "새로운 수업 자료를 만들고 바로 검토 흐름에 올립니다.",
        href: "/studio",
        actionLabel: "스튜디오 열기",
      },
    ];
  }, [viewerRole]);

  const guidanceItems = useMemo(() => {
    if (viewerRole === "teacher") {
      return [
        {
          title: "수정 필요는 가장 먼저",
          description: "검토 메모와 코멘트를 먼저 확인한 뒤, 수정 반영 후 다시 검토 요청하는 흐름이 가장 안정적입니다.",
        },
        {
          title: "초안은 오래 묵히지 않기",
          description: "수업 직전까지 초안으로만 두면 검토 여유가 사라집니다. 넘길 레슨은 미리 검토 요청으로 바꿔주세요.",
        },
        {
          title: "검토자 지정은 필수에 가깝게",
          description: "누가 볼지 정한 채로 넘기면 커뮤니케이션이 훨씬 짧아지고 응답도 빨라집니다.",
        },
      ];
    }

    if (viewerRole === "reviewer") {
      return [
        {
          title: "검토 큐는 짧게 유지",
          description: "검토 대기 건이 쌓이면 작성자 작업이 같이 멈춥니다. 짧은 판단으로 먼저 흐름을 열어주는 게 중요합니다.",
        },
        {
          title: "승인보다 피드백 품질",
          description: "애매하면 바로 승인하기보다, 다음 수정이 쉬운 코멘트를 남기는 편이 전체적으로 더 빠릅니다.",
        },
        {
          title: "코멘트는 행동 단위로",
          description: "무엇이 부족한지보다 무엇을 바꾸면 되는지를 써주면 작성자가 바로 반영할 수 있습니다.",
        },
      ];
    }

    return [
      {
        title: "병목부터 해소",
        description: "검토함이 쌓이면 팀 전체 속도가 느려집니다. 내 작업보다 검토 큐를 먼저 보는 편이 대부분 더 효율적입니다.",
      },
      {
        title: "수정 요청 기준 통일",
        description: "검토 기준이 흔들리면 강사마다 다시 묻는 비용이 생깁니다. 공통 기준을 짧고 일관되게 유지하세요.",
      },
      {
        title: "승인 후에도 맥락 남기기",
        description: "좋았던 점과 아쉬운 점을 코멘트로 남겨두면 다음 레슨 품질이 더 빨리 올라갑니다.",
      },
    ];
  }, [viewerRole]);

  const showReviewerBoard = viewerRole === "admin" || viewerRole === "lead_teacher";
  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return null;
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(lastUpdatedAt));
  }, [lastUpdatedAt]);
  const prioritizedReviewerBoard = useMemo(
    () =>
      [...reviewerBoard]
        .sort((a, b) => {
          if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
          if (b.queueCount !== a.queueCount) return b.queueCount - a.queueCount;
          return b.maxWaitHours - a.maxWaitHours;
        })
        .slice(0, 6),
    [reviewerBoard]
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--color-bg)" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", padding: "28px 24px 40px" }}>
        <div style={{ marginBottom: "22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <div style={{ fontSize: "13px", color: "var(--color-text-subtle)" }}>
              {roleLabel} 작업함
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {lastUpdatedLabel && (
                <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                  마지막 갱신 {lastUpdatedLabel}
                  {refreshing ? " · 갱신 중" : ""}
                </div>
              )}
              <button
                type="button"
                onClick={() => void reloadSummary()}
                disabled={loading || refreshing}
                style={{
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text-muted)",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: loading || refreshing ? "not-allowed" : "pointer",
                  opacity: loading || refreshing ? 0.7 : 1,
                }}
              >
                {refreshing ? "갱신 중..." : "새로고침"}
              </button>
            </div>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: "750", color: "var(--color-text)", letterSpacing: "-0.03em", margin: 0 }}>
            {heroCopy.title}
          </h1>
          <p style={{ marginTop: "10px", fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.7, maxWidth: "720px" }}>
            {heroCopy.description}
          </p>
          {actionError && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #FECACA",
                background: "#FEF2F2",
                color: "#B91C1C",
                fontSize: "12px",
                fontWeight: "600",
              }}
            >
              {actionError}
            </div>
          )}
        </div>

        <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px 18px 16px", marginBottom: "16px" }}>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", marginBottom: "8px" }}>{heroCopy.focusTitle}</div>
          <div style={{ fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>{heroCopy.focusBody}</div>
        </section>

        {(summary.reviewQueue > 0 || summary.myInReview > 0) && (
          <section style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#92400E", marginBottom: "8px" }}>검토 SLA 추적</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
              <SlaStat label="내 검토 대기 평균" value={`${summary.myAverageWaitHours}시간`} />
              <SlaStat label="검토 큐 평균" value={`${summary.averageReviewWaitHours}시간`} />
              <SlaStat label="가장 오래된 검토" value={`${summary.maxReviewWaitHours}시간`} />
              <SlaStat label={`${summary.reviewSlaHours}시간 초과`} value={`${summary.overdueReviewCount}건`} />
            </div>
          </section>
        )}

        {(summary.reassignedToMeCount > 0 || summary.reassignedFromMeCount > 0) && (
          <section style={{ background: "#F8FAFC", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)" }}>재배정 알림</div>
              <button
                onClick={() => void acknowledgeReassignmentAlerts()}
                style={{
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text-muted)",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                읽음 처리
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <SlaStat label="내게 새로 배정됨" value={`${summary.reassignedToMeCount}건`} />
              <SlaStat label="다른 검토자로 이동" value={`${summary.reassignedFromMeCount}건`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginTop: "12px" }}>
              <ReassignmentList
                title="새로 맡은 검토"
                emptyText="새로 맡은 검토가 없습니다."
                items={reassignmentItems.toMe}
                hrefBuilder={(item) =>
                  item.lessonId
                    ? `/library?scope=review&status=in_review&reassigned=to_me&lesson_id=${item.lessonId}`
                    : "/library?scope=review&status=in_review&reassigned=to_me"
                }
                linkLabel="검토 열기"
              />
              <ReassignmentList
                title="내 검토에서 이동됨"
                emptyText="이동된 검토가 없습니다."
                items={reassignmentItems.fromMe}
                hrefBuilder={(item) =>
                  item.lessonId
                    ? `/library?scope=all&status=in_review&reassigned=from_me&lesson_id=${item.lessonId}&panel=activities`
                    : "/library?scope=all&status=in_review&reassigned=from_me"
                }
                linkLabel="이력 보기"
              />
            </div>
          </section>
        )}

        {showReviewerBoard && prioritizedReviewerBoard.length > 0 && (
          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)" }}>검토자별 SLA 보드</div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                  검토 큐와 지연 시간을 같이 보고 배정을 조정할 수 있습니다.
                </div>
              </div>
              <Link href="/library?scope=review&status=in_review" style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-primary)", textDecoration: "none" }}>
                검토함 열기
              </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
              {prioritizedReviewerBoard.map((reviewer) => (
                <ReviewerBoardCard
                  key={reviewer.id}
                  reviewer={reviewer}
                  reviewSlaHours={summary.reviewSlaHours}
                  reviewers={reviewers}
                  reassignTargets={reassignTargets}
                  setReassignTargets={setReassignTargets}
                  onReassign={reassignLesson}
                  reassigningLessonId={reassigningLessonId}
                  loading={loading}
                />
              ))}
            </div>
          </section>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "24px" }}>
          {prioritizedCards.map((card) => (
            <WorkCard key={card.title} {...card} loading={loading} />
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)", gap: "16px" }}>
          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px 18px 16px" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", marginBottom: "12px" }}>빠른 이동</div>
            {quickActions.map((action) => (
              <ActionRow key={action.title} {...action} />
            ))}
          </section>

          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px 18px 16px" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", marginBottom: "12px" }}>오늘의 안내</div>
            {guidanceItems.map((item) => (
              <GuidanceItem key={item.title} {...item} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function WorkCard({
  title,
  value,
  description,
  href,
  query,
  tone,
  meta,
  loading,
}: {
  title: string;
  value: number;
  description: string;
  href: string;
  query: string;
  tone: "neutral" | "warning" | "review" | "success";
  meta?: string;
  loading: boolean;
}) {
  const palette = {
    neutral: { bg: "var(--color-surface)", border: "var(--color-border)", text: "var(--color-text)" },
    warning: { bg: "#FFF7ED", border: "#FED7AA", text: "#C2410C" },
    review: { bg: "#EEF2FF", border: "#C7D2FE", text: "#4338CA" },
    success: { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D" },
  }[tone];

  return (
    <Link
      href={`${href}${query}`}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "14px",
        padding: "16px",
        textDecoration: "none",
        display: "block",
      }}
    >
      <div style={{ fontSize: "12px", color: "var(--color-text-subtle)", marginBottom: "6px" }}>{title}</div>
      <div style={{ fontSize: "30px", lineHeight: 1, fontWeight: "750", color: palette.text, marginBottom: "8px" }}>
        {loading ? "…" : value}
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>{description}</div>
      {meta && (
        <div style={{ marginTop: "8px", fontSize: "11px", fontWeight: "600", color: palette.text }}>
          {meta}
        </div>
      )}
    </Link>
  );
}

function SlaStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.65)", border: "1px solid #FDE68A", borderRadius: "10px", padding: "12px" }}>
      <div style={{ fontSize: "11px", color: "#A16207", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: "750", color: "#92400E" }}>{value}</div>
    </div>
  );
}

function ReviewerBoardCard({
  reviewer,
  reviewSlaHours,
  reviewers,
  reassignTargets,
  setReassignTargets,
  onReassign,
  reassigningLessonId,
  loading,
}: {
  reviewer: ReviewerBoardItem;
  reviewSlaHours: number;
  reviewers: ReviewerOption[];
  reassignTargets: Record<string, string>;
  setReassignTargets: Dispatch<SetStateAction<Record<string, string>>>;
  onReassign: (lessonId: string, nextReviewerId: string) => Promise<void>;
  reassigningLessonId: string | null;
  loading: boolean;
}) {
  const tone =
    reviewer.overdueCount > 0
      ? { bg: "#FEF2F2", border: "#FECACA", title: "#B91C1C" }
      : reviewer.queueCount > 0
        ? { bg: "#FFFBEB", border: "#FDE68A", title: "#A16207" }
        : { bg: "#F8FAFC", border: "var(--color-border)", title: "var(--color-text)" };

  return (
    <div
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: "12px",
        padding: "14px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: "700", color: tone.title }}>
            {reviewer.name}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>{reviewer.role}</div>
        </div>
        <div style={{ fontSize: "20px", fontWeight: "750", color: tone.title }}>
          {loading ? "…" : reviewer.queueCount}
        </div>
      </div>
      <div style={{ display: "grid", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)" }}>
        <div>평균 대기: {reviewer.averageWaitHours}시간</div>
        <div>최장 대기: {reviewer.maxWaitHours}시간</div>
        <div>{reviewSlaHours}시간 초과: {reviewer.overdueCount}건</div>
      </div>
      {reviewer.queueItems.length > 0 && (
        <div style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
          {reviewer.queueItems.map((item) => {
            const options = reviewers.filter((candidate) => candidate.id !== reviewer.id);
            const selectedTarget = reassignTargets[item.id] ?? options[0]?.id ?? "";
            const recommendedTarget =
              options.find((candidate) => candidate.isRecommended) ?? options[0] ?? null;
            const selectedTargetInfo = options.find((candidate) => candidate.id === selectedTarget) ?? null;
            return (
              <div
                key={item.id}
                style={{
                  background: "rgba(255,255,255,0.7)",
                  border: "1px solid rgba(148,163,184,0.2)",
                  borderRadius: "10px",
                  padding: "10px",
                }}
                >
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "4px" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
                    대기 {item.waitHours}시간
                  </div>
                  {recommendedTarget && (
                    <div
                      style={{
                        marginBottom: "8px",
                        fontSize: "11px",
                        color: "#1D4ED8",
                        background: "#EFF6FF",
                        border: "1px solid #BFDBFE",
                        borderRadius: "8px",
                        padding: "6px 8px",
                        lineHeight: 1.6,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                        <span>추천 대상: {recommendedTarget.name}</span>
                        {selectedTarget !== recommendedTarget.id && (
                          <button
                            type="button"
                            onClick={() =>
                              setReassignTargets((prev) => ({
                                ...prev,
                                [item.id]: recommendedTarget.id,
                              }))
                            }
                            style={{
                              padding: "4px 7px",
                              borderRadius: "999px",
                              border: "none",
                              background: "#DBEAFE",
                              color: "#1D4ED8",
                              fontSize: "10px",
                              fontWeight: "700",
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            추천으로 변경
                          </button>
                        )}
                      </div>
                      <div style={{ marginTop: "4px", color: "#1E40AF" }}>
                        {recommendedTarget.recommendationReason ??
                          `대기 ${recommendedTarget.queueCount}건 · 평균 ${recommendedTarget.averageWaitHours}시간`}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <select
                      value={selectedTarget}
                    onChange={(e) =>
                      setReassignTargets((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "#fff",
                      fontSize: "11px",
                    }}
                    >
                      {options.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name} · 대기 {candidate.queueCount}건 · 평균 {candidate.averageWaitHours}시간
                        </option>
                      ))}
                    </select>
                    <button
                    onClick={() => void onReassign(item.id, selectedTarget)}
                    disabled={!selectedTarget || reassigningLessonId === item.id}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "none",
                      background: "#DBEAFE",
                      color: "#1D4ED8",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: !selectedTarget || reassigningLessonId === item.id ? "not-allowed" : "pointer",
                      opacity: !selectedTarget || reassigningLessonId === item.id ? 0.6 : 1,
                    }}
                    >
                      {reassigningLessonId === item.id ? "이동 중..." : "재배정"}
                    </button>
                  </div>
                  {selectedTargetInfo && (
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                      선택 대상: {selectedTargetInfo.name}
                      {selectedTargetInfo.id === recommendedTarget?.id ? " · 추천 대상" : ""}
                      {` · 대기 ${selectedTargetInfo.queueCount}건 · 평균 ${selectedTargetInfo.averageWaitHours}시간`}
                    </div>
                  )}
                </div>
              );
          })}
        </div>
      )}
    </div>
  );
}

function ReassignmentList({
  title,
  emptyText,
  items,
  hrefBuilder,
  linkLabel,
}: {
  title: string;
  emptyText: string;
  items: ReassignmentItem[];
  hrefBuilder: (item: ReassignmentItem) => string;
  linkLabel: string;
}) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "12px", padding: "12px" }}>
      <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)", marginBottom: "10px" }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {items.map((item) => (
            <div key={`${title}-${item.lessonId}-${item.createdAt}`} style={{ borderTop: "1px solid var(--color-border)", paddingTop: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "4px" }}>{item.lessonTitle}</div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                상대: {item.counterpartyName}
              </div>
              {item.reason && (
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                  사유: {item.reason}
                </div>
              )}
              <Link
                href={hrefBuilder(item)}
                style={{ display: "inline-block", marginTop: "6px", fontSize: "11px", fontWeight: "700", color: "var(--color-primary)", textDecoration: "none" }}
              >
                {linkLabel}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <div style={{ padding: "12px 0", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: "14px", fontWeight: "650", color: "var(--color-text)", marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6, marginBottom: "8px" }}>{description}</div>
      <Link href={href} style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-primary)", textDecoration: "none" }}>
        {actionLabel}
      </Link>
    </div>
  );
}

function GuidanceItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ padding: "12px 0", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: "14px", fontWeight: "650", color: "var(--color-text)", marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>{description}</div>
    </div>
  );
}
