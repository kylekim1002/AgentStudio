"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LessonPackage, DifficultyLevel } from "@/lib/agents/types";
import { LESSON_ACTIVITY_LABELS, LessonActivity, LESSON_STATUS_LABELS, LessonComment, LessonStatus } from "@/lib/collab/lesson";
import { downloadBlob, safeFilename } from "@/lib/export/downloadFile";
import { AppRole } from "@/lib/authz/roles";
import { DEFAULT_REVIEW_NOTE_TEMPLATES, ReviewNoteTemplates } from "@/lib/reviewTemplates";
import { DEFAULT_REVIEW_SLA_HOURS, getReviewWarningHours } from "@/lib/reviewSettings";
import { dispatchInboxSync, subscribeInboxSync } from "@/lib/ui/inboxSync";

// ─── Types ───────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  created_at: string;
}

interface LessonSummary {
  id: string;
  user_id?: string;
  reviewer_id?: string | null;
  owner_name?: string | null;
  reviewer_name?: string | null;
  title: string;
  difficulty: DifficultyLevel;
  provider: string;
  status: LessonStatus;
  review_notes?: string | null;
  created_at: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reassigned_badge?: "to_me" | "from_me" | null;
  project_id: string | null;
  tags: string[];
  isFavorite: boolean;
}

interface LessonDetailResponse {
  package: LessonPackage;
  status: LessonStatus;
  review_notes?: string | null;
  owner_name?: string | null;
  reviewer_name?: string | null;
  reviewer_id?: string | null;
  assignment_mode?: "auto" | "manual" | null;
  assignment_note?: string | null;
}

// ─── Difficulty badge colours ────────────────────────────────

const DIFF_COLOR: Record<string, { bg: string; text: string }> = {
  beginner:         { bg: "#F0FDF4", text: "#16A34A" },
  elementary:       { bg: "#ECFDF5", text: "#059669" },
  intermediate:     { bg: "#EFF6FF", text: "#2563EB" },
  "upper-intermediate": { bg: "#F5F3FF", text: "#7C3AED" },
  advanced:         { bg: "#FFF7ED", text: "#D97706" },
};

const DIFF_LABEL: Record<string, string> = {
  beginner: "초급", elementary: "기초", intermediate: "중급",
  "upper-intermediate": "중상급", advanced: "고급",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function getReviewAgeHours(submittedAt?: string | null) {
  if (!submittedAt) return null;
  return Math.max(
    0,
    Math.round(((Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60)) * 10) / 10
  );
}

// ─── Component ───────────────────────────────────────────────

export default function LibraryClient({
  viewerId,
  canExportTeacher = true,
  canManageReview = false,
  viewerRole,
  initialScope = "all",
  initialStatus = "all",
  initialFavorite = false,
  initialSearch = "",
  initialProjectId = null,
  initialLessonId = null,
  initialPanel = null,
  initialReassignedFilter = "all",
}: {
  viewerId: string;
  canExportTeacher?: boolean;
  canManageReview?: boolean;
  viewerRole: AppRole;
  initialScope?: "all" | "mine" | "review";
  initialStatus?: "all" | LessonStatus;
  initialFavorite?: boolean;
  initialSearch?: string;
  initialProjectId?: string | null;
  initialLessonId?: string | null;
  initialPanel?: "comments" | "activities" | null;
  initialReassignedFilter?: "all" | "to_me" | "from_me";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects]         = useState<Project[]>([]);
  const [lessons, setLessons]           = useState<LessonSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(initialProjectId); // null = 전체
  const [selectedLesson, setSelectedLesson]   = useState<LessonSummary | null>(null);
  const [lessonDetail, setLessonDetail] = useState<LessonDetailResponse | null>(null);
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [activities, setActivities] = useState<LessonActivity[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [search, setSearch]             = useState(initialSearch);
  const [favOnly, setFavOnly]           = useState(initialFavorite);
  const [scope, setScope] = useState<"all" | "mine" | "review">(initialScope);
  const [statusFilter, setStatusFilter] = useState<"all" | LessonStatus>(initialStatus);
  const [reassignedFilter, setReassignedFilter] = useState<"all" | "to_me" | "from_me">(initialReassignedFilter);
  const [copiedLinkType, setCopiedLinkType] = useState<"review" | "comments" | "activities" | null>(null);
  const [shareMenuLessonId, setShareMenuLessonId] = useState<string | null>(null);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [reviewTemplates, setReviewTemplates] = useState<ReviewNoteTemplates>(DEFAULT_REVIEW_NOTE_TEMPLATES);
  const [reviewSlaHours, setReviewSlaHours] = useState(DEFAULT_REVIEW_SLA_HOURS);
  const [loading, setLoading]           = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjName, setNewProjName]   = useState("");
  const [newProjCode, setNewProjCode]   = useState("");
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(initialLessonId);
  const [activePanel, setActivePanel] = useState<"comments" | "activities" | null>(initialPanel);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // ── Load projects ──────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const { projects } = await res.json();
      setProjects(projects ?? []);
    }
  }, []);

  // ── Load lessons ───────────────────────────────────────────
  const loadLessonDetail = useCallback(async (lessonId: string, lessonSummary?: LessonSummary | null) => {
    const res = await fetch(`/api/lessons/${lessonId}`);
    if (!res.ok || !isMountedRef.current) return;
    const data = await res.json();
    const nextSummary =
      lessonSummary ??
      lessons.find((item) => item.id === lessonId) ??
      selectedLesson;

    if (nextSummary) {
      setSelectedLesson(nextSummary);
    }
    setLessonDetail({
      package: data.lesson?.package ?? null,
      status: data.lesson?.status ?? "draft",
      review_notes: data.lesson?.review_notes ?? null,
      owner_name: data.lesson?.owner_name ?? null,
      reviewer_name: data.lesson?.reviewer_name ?? null,
      reviewer_id: data.lesson?.reviewer_id ?? null,
      assignment_mode: data.lesson?.assignment_mode ?? null,
      assignment_note: data.lesson?.assignment_note ?? null,
    });
    setComments(data.comments ?? []);
    setActivities(data.activities ?? []);
  }, [lessons, selectedLesson]);

  const loadLessons = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const params = new URLSearchParams();
    if (selectedProject) params.set("project_id", selectedProject);
    if (search)          params.set("search", search);
    if (favOnly)         params.set("favorite", "true");
    if (canManageReview) params.set("scope", scope);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (reassignedFilter !== "all") params.set("reassigned", reassignedFilter);

    const res = await fetch(`/api/lessons?${params}`);
    if (res.ok) {
      const { lessons: nextLessons } = await res.json();
      if (!isMountedRef.current) return;
      const lessonRows = nextLessons ?? [];
      setLessons(lessonRows);
      setLastUpdatedAt(new Date().toISOString());

      if (selectedLesson) {
        const refreshedSelectedLesson = lessonRows.find((lesson: LessonSummary) => lesson.id === selectedLesson.id) ?? null;
        if (refreshedSelectedLesson) {
          void loadLessonDetail(refreshedSelectedLesson.id, refreshedSelectedLesson);
        }
      }
    }
    if (!isMountedRef.current) return;
    if (silent) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  }, [selectedProject, search, favOnly, scope, canManageReview, statusFilter, reassignedFilter, selectedLesson, loadLessonDetail]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadLessons(); }, [loadLessons]);
  useEffect(() => {
    isMountedRef.current = true;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void loadLessons({ silent: true });
    }, 60000);

    function handleInboxSync() {
      void loadLessons({ silent: true });
    }

    const unsubscribe = subscribeInboxSync(handleInboxSync);

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [loadLessons]);
  useEffect(() => {
    fetch("/api/system-settings/review-templates")
      .then((res) => res.json())
      .then(({ templates, slaHours }) => {
        if (templates) setReviewTemplates(templates);
        if (slaHours !== undefined) setReviewSlaHours(Number(slaHours));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const params = new URLSearchParams();

    if (canManageReview && scope !== "all") params.set("scope", scope);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (reassignedFilter !== "all") params.set("reassigned", reassignedFilter);
    if (favOnly) params.set("favorite", "true");
    if (search.trim()) params.set("search", search.trim());
    if (selectedProject) params.set("project_id", selectedProject);
    if (selectedLesson?.id) params.set("lesson_id", selectedLesson.id);
    if (selectedLesson?.id && activePanel) params.set("panel", activePanel);

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [activePanel, canManageReview, favOnly, pathname, reassignedFilter, router, scope, search, selectedLesson?.id, selectedProject, statusFilter]);

  useEffect(() => {
    if (!pendingLessonId) return;
    const lesson = lessons.find((item) => item.id === pendingLessonId);
    if (lesson) {
      void selectLesson(lesson);
      setPendingLessonId(null);
      return;
    }
    if (!loading) {
      setPendingLessonId(null);
    }
  }, [lessons, loading, pendingLessonId]);

  useEffect(() => {
    if (!selectedLesson) return;
    const exists = lessons.some((lesson) => lesson.id === selectedLesson.id);
    if (!exists) {
      setSelectedLesson(null);
      setLessonDetail(null);
      setComments([]);
      setActivities([]);
      setActivePanel(null);
    }
  }, [lessons, selectedLesson]);

  useEffect(() => {
    function handleWindowClick() {
      setShareMenuLessonId(null);
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    setSelectedReviewIds([]);
  }, [scope, statusFilter, selectedProject, favOnly, search, reassignedFilter]);

  // ── Load lesson detail ─────────────────────────────────────
  async function selectLesson(lesson: LessonSummary) {
    setSelectedLesson(lesson);
    setLessonDetail(null);
    await loadLessonDetail(lesson.id, lesson);
  }

  // ── Export lesson ──────────────────────────────────────────
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(type: "student" | "teacher", format: "pdf" | "docx") {
    if (!lessonDetail) return;
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      const fname = safeFilename(lessonDetail.package.title);
      const label = type === "teacher" ? "교사용" : "학생용";
      if (format === "pdf") {
        const { generatePdf } = await import("@/lib/export/generatePdf");
        const blob = await generatePdf(lessonDetail.package, type, "simple");
        downloadBlob(blob, `${fname}_${label}.pdf`);
      } else {
        const { generateDocx } = await import("@/lib/export/generateDocx");
        const blob = await generateDocx(lessonDetail.package, type);
        downloadBlob(blob, `${fname}_${label}.docx`);
      }
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(null);
    }
  }

  async function addComment() {
    if (!selectedLesson || !commentDraft.trim()) return;
    const res = await fetch(`/api/lessons/${selectedLesson.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentDraft }),
    });
    if (!res.ok) return;
    const { comment } = await res.json();
    setComments((prev) => [...prev, comment]);
    setCommentDraft("");
    dispatchInboxSync("lesson_commented");
    await selectLesson(selectedLesson);
  }

  async function updateReview(
    status: LessonStatus,
    options?: {
      promptForNotes?: boolean;
      promptMessage?: string;
      template?: {
        kind: "approved" | "needs_revision";
        text: string;
      };
    }
  ) {
    if (!selectedLesson) return;
    const shouldPrompt = options?.promptForNotes ?? true;
    const reviewNotes = shouldPrompt
      ? window.prompt(options?.promptMessage ?? "검토 메모를 남겨주세요.", lessonDetail?.review_notes ?? "")
      : lessonDetail?.review_notes ?? null;
    const res = await fetch(`/api/lessons/${selectedLesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        review_notes: reviewNotes ?? lessonDetail?.review_notes ?? null,
        review_template: options?.template
          ? {
              used: true,
              kind: options.template.kind,
              text: options.template.text,
            }
          : null,
      }),
    });
    if (!res.ok) return;
    const { lesson } = await res.json();
    dispatchInboxSync("lesson_reviewed");
    setLessons((prev) => prev.map((item) => item.id === lesson.id ? { ...item, status: lesson.status, review_notes: lesson.review_notes } : item));
    setSelectedLesson((prev) => prev ? { ...prev, status: lesson.status, review_notes: lesson.review_notes } : prev);
    setLessonDetail((prev) => prev ? { ...prev, status: lesson.status, review_notes: lesson.review_notes } : prev);
    await selectLesson({
      ...(selectedLesson as LessonSummary),
      status: lesson.status,
      review_notes: lesson.review_notes,
    });
  }

  async function updateReviewFromCard(
    lesson: LessonSummary,
    status: LessonStatus,
    promptMessage: string,
    template?: {
      kind: "approved" | "needs_revision";
      text: string;
    }
  ) {
    const reviewNotes = window.prompt(promptMessage, lesson.review_notes ?? "");
    const res = await fetch(`/api/lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        review_notes: reviewNotes ?? lesson.review_notes ?? null,
        review_template: template
          ? {
              used: true,
              kind: template.kind,
              text: template.text,
            }
          : null,
      }),
    });
    if (!res.ok) return;

    const { lesson: updatedLesson } = await res.json();
    dispatchInboxSync("lesson_reviewed");
    setLessons((prev) =>
      prev.map((item) =>
        item.id === updatedLesson.id
          ? { ...item, status: updatedLesson.status, review_notes: updatedLesson.review_notes }
          : item
      )
    );

    if (selectedLesson?.id === lesson.id) {
      await selectLesson({
        ...lesson,
        status: updatedLesson.status,
        review_notes: updatedLesson.review_notes,
      });
    }
  }

  async function batchUpdateReview(
    status: LessonStatus,
    promptMessage: string,
    template?: {
      kind: "approved" | "needs_revision";
      text: string;
    }
  ) {
    if (selectedReviewIds.length === 0) return;
    const reviewNotes = window.prompt(promptMessage, "");

    await Promise.all(
      selectedReviewIds.map((lessonId) =>
        fetch(`/api/lessons/${lessonId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            review_notes: reviewNotes ?? null,
            review_template: template
              ? {
                  used: true,
                  kind: template.kind,
                  text: template.text,
                }
              : null,
          }),
        })
      )
    );

    dispatchInboxSync("lesson_reviewed");
    setSelectedReviewIds([]);
    await loadLessons();

    if (selectedLesson && selectedReviewIds.includes(selectedLesson.id)) {
      const nextLesson = lessons.find((lesson) => lesson.id === selectedLesson.id);
      if (nextLesson) {
        await selectLesson({
          ...nextLesson,
          status,
          review_notes: reviewNotes ?? nextLesson.review_notes ?? null,
        });
      }
    }
  }

  async function batchUpdateReviewWithTemplate(
    status: LessonStatus,
    promptMessage: string,
    template: string
  ) {
    await batchUpdateReview(status, promptMessage, {
      kind: status === "approved" ? "approved" : "needs_revision",
      text: template,
    });
  }

  async function updateReviewWithTemplate(
    status: LessonStatus,
    promptMessage: string,
    template: string
  ) {
    await updateReview(status, {
      promptForNotes: true,
      promptMessage,
      template: {
        kind: status === "approved" ? "approved" : "needs_revision",
        text: template,
      },
    });
  }

  async function updateReviewFromCardWithTemplate(
    lesson: LessonSummary,
    status: LessonStatus,
    promptMessage: string,
    template: string
  ) {
    await updateReviewFromCard(lesson, status, promptMessage, {
      kind: status === "approved" ? "approved" : "needs_revision",
      text: template,
    });
  }

  async function copyLessonLink(type: "review" | "comments" | "activities") {
    if (!selectedLesson) return;

    const params = new URLSearchParams();
    if (canManageReview && scope !== "all") params.set("scope", scope);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (favOnly) params.set("favorite", "true");
    if (search.trim()) params.set("search", search.trim());
    if (selectedProject) params.set("project_id", selectedProject);
    params.set("lesson_id", selectedLesson.id);
    if (type === "comments" || type === "activities") {
      params.set("panel", type);
    }

    const url = `${window.location.origin}${pathname}?${params.toString()}`;
    await navigator.clipboard.writeText(url);
    setCopiedLinkType(type);
    window.setTimeout(() => setCopiedLinkType((current) => (current === type ? null : current)), 1800);
  }

  function getRecommendedLinkType(status: LessonStatus): "review" | "comments" | "activities" {
    if (status === "in_review") return "review";
    if (status === "needs_revision") return "comments";
    return "activities";
  }

  async function copyLessonLinkFromCard(
    lesson: LessonSummary,
    type?: "review" | "comments" | "activities"
  ) {
    const linkType = type ?? getRecommendedLinkType(lesson.status);
    const params = new URLSearchParams();

    if (canManageReview && scope !== "all") params.set("scope", scope);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (favOnly) params.set("favorite", "true");
    if (search.trim()) params.set("search", search.trim());
    if (selectedProject) params.set("project_id", selectedProject);
    params.set("lesson_id", lesson.id);
    if (linkType === "comments" || linkType === "activities") {
      params.set("panel", linkType);
    }

    const url = `${window.location.origin}${pathname}?${params.toString()}`;
    await navigator.clipboard.writeText(url);
    setCopiedLinkType(linkType);
    window.setTimeout(() => setCopiedLinkType((current) => (current === linkType ? null : current)), 1800);
  }

  // ── Toggle favorite ────────────────────────────────────────
  async function toggleFav(lessonId: string, isFav: boolean) {
    await fetch(`/api/lessons/${lessonId}/favorite`, { method: isFav ? "DELETE" : "POST" });
    dispatchInboxSync("lesson_favorited");
    setLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, isFavorite: !isFav } : l));
  }

  // ── Create project ─────────────────────────────────────────
  async function createProject() {
    if (!newProjName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjName.trim(), code: newProjCode.trim() || null }),
    });
    if (res.ok) {
      await loadProjects();
      setShowNewProject(false);
      setNewProjName("");
      setNewProjCode("");
    }
  }

  const filteredLessons = lessons; // server-side filtering already applied
  const canShowReviewActions = canManageReview && (viewerRole === "admin" || viewerRole === "lead_teacher" || viewerRole === "reviewer");
  const isOwner = selectedLesson?.user_id === viewerId;
  const canReviewCurrentLesson =
    canShowReviewActions &&
    !!selectedLesson &&
    (viewerRole === "admin" || viewerRole === "lead_teacher" || selectedLesson.reviewer_id === viewerId);
  const recommendedLinkType: "review" | "comments" | "activities" =
    lessonDetail?.status === "in_review"
      ? "review"
      : lessonDetail?.status === "needs_revision"
        ? "comments"
        : "activities";
  const draftCount = lessons.filter((lesson) => lesson.status === "draft" || lesson.status === "needs_revision").length;
  const reviewCount = lessons.filter((lesson) => lesson.status === "in_review").length;
  const approvedCount = lessons.filter((lesson) => lesson.status === "approved" || lesson.status === "published").length;
  const reviewSelectableLessons = lessons.filter((lesson) =>
    lesson.status === "in_review" &&
    (viewerRole === "admin" || viewerRole === "lead_teacher" || lesson.reviewer_id === viewerId)
  );
  const allReviewSelected =
    reviewSelectableLessons.length > 0 &&
    reviewSelectableLessons.every((lesson) => selectedReviewIds.includes(lesson.id));
  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return null;
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(lastUpdatedAt));
  }, [lastUpdatedAt]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* ── LEFT: Project tree ── */}
      <aside style={{
        width: "220px", flexShrink: 0,
        background: "var(--color-surface)", borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "11px 14px 9px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-subtle)", letterSpacing: ".5px", textTransform: "uppercase" }}>프로젝트</span>
          <button
            onClick={() => setShowNewProject(true)}
            title="새 프로젝트"
            style={{ width: "22px", height: "22px", borderRadius: "5px", border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text-muted)", fontSize: "16px", lineHeight: "1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >+</button>
        </div>

        {canManageReview && (
          <div style={{ padding: "8px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: "4px" }}>
            {([
              { value: "all", label: "전체" },
              { value: "mine", label: "내 작업" },
              { value: "review", label: "검토함" },
            ] as const).map((item) => (
              <button
                key={item.value}
                onClick={() => setScope(item.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: `1px solid ${scope === item.value ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: scope === item.value ? "var(--color-primary-light)" : "var(--color-surface)",
                  color: scope === item.value ? "var(--color-primary)" : "var(--color-text-muted)",
                  fontSize: "11px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {/* All */}
          <ProjectItem
            active={selectedProject === null}
            label="전체 레슨"
            count={lessons.length}
            onClick={() => setSelectedProject(null)}
            icon="📂"
          />
          <ProjectItem
            active={favOnly}
            label="즐겨찾기"
            count={lessons.filter((l) => l.isFavorite).length}
            onClick={() => { setFavOnly((v) => !v); setSelectedProject(null); }}
            icon="⭐"
          />

          {projects.length > 0 && (
            <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", padding: "10px 8px 4px", letterSpacing: ".3px", textTransform: "uppercase" }}>
              내 프로젝트
            </div>
          )}

          {projects.map((p) => (
            <ProjectItem
              key={p.id}
              active={selectedProject === p.id}
              label={p.name}
              code={p.code ?? undefined}
              count={lessons.filter((l) => l.project_id === p.id).length}
              onClick={() => { setSelectedProject(p.id); setFavOnly(false); }}
              icon="📁"
            />
          ))}
        </div>

        {/* New project form */}
        {showNewProject && (
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
            <input
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="프로젝트 이름"
              autoFocus
              style={{ width: "100%", padding: "6px 8px", borderRadius: "5px", border: "1px solid var(--color-border-strong)", fontSize: "12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "5px" }}
            />
            <input
              value={newProjCode}
              onChange={(e) => setNewProjCode(e.target.value)}
              placeholder="코드값 (선택)"
              style={{ width: "100%", padding: "6px 8px", borderRadius: "5px", border: "1px solid var(--color-border-strong)", fontSize: "12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "7px" }}
            />
            <div style={{ display: "flex", gap: "5px" }}>
              <button onClick={() => setShowNewProject(false)} style={{ flex: 1, padding: "5px", borderRadius: "5px", border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: "11px", cursor: "pointer", color: "var(--color-text-muted)" }}>취소</button>
              <button onClick={createProject} style={{ flex: 1, padding: "5px", borderRadius: "5px", border: "none", background: "var(--color-primary)", color: "#fff", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>만들기</button>
            </div>
          </div>
        )}
      </aside>

      {/* ── CENTER: Lesson cards ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>
        {/* Search bar */}
        <div style={{ padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", background: "var(--color-bg)", border: "1px solid var(--color-border-strong)", borderRadius: "7px", padding: "6px 10px" }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="var(--color-text-subtle)" strokeWidth="1.3"/><path d="M9 9l3 3" stroke="var(--color-text-subtle)" strokeWidth="1.3" strokeLinecap="round"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="레슨 검색..."
              style={{ flex: 1, border: "none", background: "transparent", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "var(--color-text)" }}
            />
          </div>
          {lastUpdatedLabel && (
            <span style={{ fontSize: "11px", color: "var(--color-text-subtle)", whiteSpace: "nowrap" }}>
              {refreshing ? "갱신 중" : `마지막 갱신 ${lastUpdatedLabel}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadLessons()}
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
              whiteSpace: "nowrap",
            }}
          >
            {refreshing ? "갱신 중..." : "새로고침"}
          </button>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            {filteredLessons.length}개
          </span>
        </div>

        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
          <SummaryCard label="작업중" value={draftCount} tone="neutral" helper={viewerRole === "teacher" ? "내가 수정할 레슨" : "초안 + 수정 필요"} />
          <SummaryCard label="검토대기" value={reviewCount} tone="warning" helper={canManageReview ? "검토함 확인 필요" : "검토 요청 보냄"} />
          <SummaryCard label="완료" value={approvedCount} tone="success" helper="승인 또는 발행 완료" />
        </div>

        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {([
            { value: "all", label: "전체 상태" },
            { value: "draft", label: "초안" },
            { value: "needs_revision", label: "수정 필요" },
            { value: "in_review", label: "검토중" },
            { value: "approved", label: "승인됨" },
            { value: "published", label: "발행 완료" },
          ] as const).map((item) => (
            <button
              key={item.value}
              onClick={() => setStatusFilter(item.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: `1px solid ${statusFilter === item.value ? "var(--color-primary)" : "var(--color-border)"}`,
                background: statusFilter === item.value ? "var(--color-primary-light)" : "var(--color-surface)",
                color: statusFilter === item.value ? "var(--color-primary)" : "var(--color-text-muted)",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {canManageReview && (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {([
              { value: "all", label: "재배정 전체" },
              { value: "to_me", label: "내게 재배정" },
              { value: "from_me", label: "내 검토에서 이동" },
            ] as const).map((item) => (
              <button
                key={item.value}
                onClick={() => setReassignedFilter(item.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: `1px solid ${reassignedFilter === item.value ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: reassignedFilter === item.value ? "var(--color-primary-light)" : "var(--color-surface)",
                  color: reassignedFilter === item.value ? "var(--color-primary)" : "var(--color-text-muted)",
                  fontSize: "11px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {reassignedFilter !== "all" && (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>재배정 필터</span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "700",
                color: reassignedFilter === "to_me" ? "#1D4ED8" : "#92400E",
                background: reassignedFilter === "to_me" ? "#DBEAFE" : "#FEF3C7",
                padding: "4px 8px",
                borderRadius: "999px",
              }}
            >
              {reassignedFilter === "to_me" ? "내게 재배정" : "내 검토에서 이동"}
            </span>
            <button
              onClick={() => setReassignedFilter("all")}
              style={{
                padding: "5px 8px",
                borderRadius: "999px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text-muted)",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              필터 해제
            </button>
          </div>
        )}

        {scope === "review" && reviewSelectableLessons.length > 0 && (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={() =>
                setSelectedReviewIds(
                  allReviewSelected ? [] : reviewSelectableLessons.map((lesson) => lesson.id)
                )
              }
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text-muted)",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {allReviewSelected ? "전체 해제" : "전체 선택"}
            </button>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              선택 {selectedReviewIds.length}건
            </span>
            <button
              onClick={() => void batchUpdateReview("approved", "일괄 승인 메모를 남겨주세요. (선택)")}
              disabled={selectedReviewIds.length === 0}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "none",
                background: selectedReviewIds.length > 0 ? "#E0E7FF" : "var(--color-border)",
                color: selectedReviewIds.length > 0 ? "#3730A3" : "var(--color-text-subtle)",
                fontSize: "11px",
                fontWeight: "700",
                cursor: selectedReviewIds.length > 0 ? "pointer" : "not-allowed",
              }}
            >
              선택 승인
            </button>
            <button
              onClick={() => void batchUpdateReview("needs_revision", "일괄 수정 요청 메모를 남겨주세요.")}
              disabled={selectedReviewIds.length === 0}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--color-border)",
                background: selectedReviewIds.length > 0 ? "var(--color-surface)" : "var(--color-bg)",
                color: selectedReviewIds.length > 0 ? "var(--color-text-muted)" : "var(--color-text-subtle)",
                fontSize: "11px",
                fontWeight: "600",
                cursor: selectedReviewIds.length > 0 ? "pointer" : "not-allowed",
              }}
            >
              선택 수정 요청
            </button>
            {selectedReviewIds.length > 0 && (
              <>
                {reviewTemplates.approved.map((template, index) => (
                  <button
                    key={`batch-approved-template-${index}`}
                    onClick={() => void batchUpdateReviewWithTemplate("approved", "일괄 승인 메모를 확인해 주세요.", template)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "1px solid #C7D2FE",
                      background: "#EEF2FF",
                      color: "#4338CA",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    승인 템플릿
                  </button>
                ))}
                {reviewTemplates.needs_revision.map((template, index) => (
                  <button
                    key={`batch-revision-template-${index}`}
                    onClick={() => void batchUpdateReviewWithTemplate("needs_revision", "일괄 수정 요청 메모를 확인해 주세요.", template)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text-muted)",
                      fontSize: "11px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    수정 템플릿
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Cards */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "var(--color-text-muted)", fontSize: "13px" }}>
              불러오는 중...
            </div>
          ) : filteredLessons.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "200px", gap: "10px", color: "var(--color-text-muted)" }}>
              <div style={{ fontSize: "28px", opacity: .4 }}>📚</div>
              <div style={{ fontSize: "13px" }}>레슨이 없습니다</div>
              <div style={{ fontSize: "12px" }}>스튜디오에서 레슨을 만들고 저장하면 여기 표시됩니다</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
              {filteredLessons.map((lesson) => {
                const dc = DIFF_COLOR[lesson.difficulty] ?? DIFF_COLOR.intermediate;
                const isActive = selectedLesson?.id === lesson.id;
                const recommendedCardLinkType = getRecommendedLinkType(lesson.status);
                const reviewAgeHours = lesson.status === "in_review" ? getReviewAgeHours(lesson.submitted_at) : null;
                const warningHours = getReviewWarningHours(reviewSlaHours);
                const reviewAgeTone =
                  reviewAgeHours === null
                    ? null
                    : reviewAgeHours >= reviewSlaHours
                      ? { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C" }
                      : reviewAgeHours >= warningHours
                        ? { bg: "#FFFBEB", border: "#FDE68A", text: "#A16207" }
                        : { bg: "#EEF2FF", border: "#C7D2FE", text: "#4338CA" };
                const canReviewLessonCard =
                  canShowReviewActions &&
                  lesson.status === "in_review" &&
                  (viewerRole === "admin" || viewerRole === "lead_teacher" || lesson.reviewer_id === viewerId);
                const isReviewSelected = selectedReviewIds.includes(lesson.id);
                return (
                  <div
                    key={lesson.id}
                    onClick={() => selectLesson(lesson)}
                    style={{
                      background: "var(--color-surface)",
                      border: `1.5px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                      borderRadius: "9px", padding: "14px",
                      cursor: "pointer", transition: "all .15s",
                      boxShadow: isActive ? "0 0 0 3px rgba(79,70,229,.1)" : undefined,
                    }}
                    onMouseOver={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)"; }}
                    onMouseOut={(e)  => { if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", flex: 1, paddingRight: "6px" }}>
                        {scope === "review" && canReviewLessonCard && (
                          <input
                            type="checkbox"
                            checked={isReviewSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedReviewIds((prev) =>
                                e.target.checked
                                  ? [...prev, lesson.id]
                                  : prev.filter((id) => id !== lesson.id)
                              );
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: "2px" }}
                          />
                        )}
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text)", lineHeight: "1.4", flex: 1 }}>
                          {lesson.title}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, position: "relative" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyLessonLinkFromCard(lesson);
                          }}
                          title={
                            recommendedCardLinkType === "review"
                              ? "검토 링크 복사"
                              : recommendedCardLinkType === "comments"
                                ? "코멘트 링크 복사"
                                : "이력 링크 복사"
                          }
                          style={{
                            border: "1px solid var(--color-border)",
                            background: copiedLinkType === recommendedCardLinkType ? "var(--color-primary-light)" : "var(--color-surface)",
                            color: copiedLinkType === recommendedCardLinkType ? "var(--color-primary)" : "var(--color-text-subtle)",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                            flexShrink: 0,
                            borderRadius: "6px",
                            padding: "3px 6px",
                            transition: ".15s",
                          }}
                        >
                          {copiedLinkType === recommendedCardLinkType ? "복사됨" : "공유"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareMenuLessonId((current) => current === lesson.id ? null : lesson.id);
                          }}
                          title="공유 메뉴"
                          style={{
                            border: "1px solid var(--color-border)",
                            background: shareMenuLessonId === lesson.id ? "var(--color-primary-light)" : "var(--color-surface)",
                            color: shareMenuLessonId === lesson.id ? "var(--color-primary)" : "var(--color-text-subtle)",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                            flexShrink: 0,
                            borderRadius: "6px",
                            padding: "3px 6px",
                            transition: ".15s",
                          }}
                        >
                          ▾
                        </button>
                        {shareMenuLessonId === lesson.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              top: "28px",
                              right: "24px",
                              minWidth: "122px",
                              background: "var(--color-surface)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "8px",
                              boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
                              overflow: "hidden",
                              zIndex: 10,
                            }}
                          >
                            {([
                              { value: "review", label: "검토 링크" },
                              { value: "comments", label: "코멘트 링크" },
                              { value: "activities", label: "이력 링크" },
                            ] as const).map((item) => (
                              <button
                                key={item.value}
                                onClick={() => {
                                  void copyLessonLinkFromCard(lesson, item.value);
                                  setShareMenuLessonId(null);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "8px 10px",
                                  border: "none",
                                  borderBottom: item.value !== "activities" ? "1px solid var(--color-border)" : "none",
                                  background: recommendedCardLinkType === item.value ? "var(--color-primary-light)" : "var(--color-surface)",
                                  color: recommendedCardLinkType === item.value ? "var(--color-primary)" : "var(--color-text-muted)",
                                  fontSize: "11px",
                                  fontWeight: recommendedCardLinkType === item.value ? "700" : "600",
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                {recommendedCardLinkType === item.value ? `${item.label} 추천` : item.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFav(lesson.id, lesson.isFavorite); }}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", flexShrink: 0, opacity: lesson.isFavorite ? 1 : .3, transition: ".15s" }}
                          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                          onMouseOut={(e)  => { (e.currentTarget as HTMLButtonElement).style.opacity = lesson.isFavorite ? "1" : "0.3"; }}
                        >
                          ⭐
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "10px" }}>
                      <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: dc.bg, color: dc.text, fontWeight: "600" }}>
                        {DIFF_LABEL[lesson.difficulty] ?? lesson.difficulty}
                      </span>
                      <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-primary-light)", color: "var(--color-primary)", fontWeight: "600" }}>
                        {LESSON_STATUS_LABELS[lesson.status]}
                      </span>
                      {lesson.reassigned_badge && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextFilter = lesson.reassigned_badge;
                            if (!nextFilter) return;
                            setReassignedFilter(nextFilter);
                            if (nextFilter === "to_me" && canManageReview) {
                              setScope("review");
                              setStatusFilter("in_review");
                            }
                            if (nextFilter === "from_me") {
                              setStatusFilter("in_review");
                            }
                          }}
                          title={lesson.reassigned_badge === "to_me" ? "내게 재배정된 항목만 보기" : "내 검토에서 이동된 항목만 보기"}
                          style={{
                            fontSize: "10px",
                            padding: "2px 7px",
                            borderRadius: "4px",
                            background: lesson.reassigned_badge === "to_me" ? "#DBEAFE" : "#FEF3C7",
                            color: lesson.reassigned_badge === "to_me" ? "#1D4ED8" : "#92400E",
                            fontWeight: "700",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {lesson.reassigned_badge === "to_me" ? "재배정됨" : "이동됨"}
                        </button>
                      )}
                      <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                        {lesson.provider}
                      </span>
                    </div>

                    <div style={{ display: "grid", gap: "4px", marginBottom: "8px" }}>
                      <MetaRow label="작성자" value={lesson.owner_name ?? "미지정"} />
                      <MetaRow label="검토자" value={lesson.reviewer_name ?? "미배정"} muted={!lesson.reviewer_name} />
                      {reviewAgeHours !== null && reviewAgeTone && (
                        <div
                          style={{
                            fontSize: "10px",
                            padding: "4px 7px",
                            borderRadius: "6px",
                            background: reviewAgeTone.bg,
                            color: reviewAgeTone.text,
                            border: `1px solid ${reviewAgeTone.border}`,
                            fontWeight: "700",
                            width: "fit-content",
                          }}
                        >
                          검토 대기 {reviewAgeHours}시간
                        </div>
                      )}
                    </div>

                    {lesson.tags?.length > 0 && (
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px" }}>
                        {lesson.tags.slice(0, 3).map((t) => (
                          <span key={t} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "var(--color-primary-light)", color: "var(--color-primary)" }}>#{t}</span>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                      {fmtDate(lesson.created_at)}
                    </div>

                    {canReviewLessonCard && (
                      <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void updateReviewFromCard(lesson, "needs_revision", "수정 요청 메모를 남겨주세요.");
                            }}
                            style={{
                              padding: "7px 8px",
                              borderRadius: "7px",
                              border: "1px solid var(--color-border)",
                              background: "var(--color-surface)",
                              color: "var(--color-text-muted)",
                              fontSize: "11px",
                              fontWeight: "600",
                              cursor: "pointer",
                            }}
                          >
                            수정 요청
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void updateReviewFromCard(lesson, "approved", "승인 메모를 남겨주세요. (선택)");
                            }}
                            style={{
                              padding: "7px 8px",
                              borderRadius: "7px",
                              border: "none",
                              background: "#E0E7FF",
                              color: "#3730A3",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                            }}
                          >
                            승인
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {reviewTemplates.approved.map((template, index) => (
                            <button
                              key={`card-approved-template-${lesson.id}-${index}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void updateReviewFromCardWithTemplate(lesson, "approved", "승인 메모를 확인해 주세요.", template);
                              }}
                              title={template}
                              style={{
                                padding: "5px 7px",
                                borderRadius: "999px",
                                border: "1px solid #C7D2FE",
                                background: "#EEF2FF",
                                color: "#3730A3",
                                fontSize: "10px",
                                fontWeight: "600",
                                cursor: "pointer",
                              }}
                            >
                              승인 템플릿
                            </button>
                          ))}
                          {reviewTemplates.needs_revision.map((template, index) => (
                            <button
                              key={`card-revision-template-${lesson.id}-${index}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void updateReviewFromCardWithTemplate(lesson, "needs_revision", "수정 요청 메모를 확인해 주세요.", template);
                              }}
                              title={template}
                              style={{
                                padding: "5px 7px",
                                borderRadius: "999px",
                                border: "1px solid var(--color-border)",
                                background: "var(--color-surface)",
                                color: "var(--color-text-muted)",
                                fontSize: "10px",
                                fontWeight: "600",
                                cursor: "pointer",
                              }}
                            >
                              수정 템플릿
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Detail panel ── */}
      <aside style={{
        width: "320px", flexShrink: 0,
        background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {!selectedLesson ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", padding: "24px", color: "var(--color-text-muted)" }}>
            <div style={{ fontSize: "28px", opacity: .35 }}>📋</div>
            <div style={{ fontSize: "13px", textAlign: "center" }}>레슨을 선택하면<br/>상세 내용을 볼 수 있습니다</div>
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>{selectedLesson.title}</div>
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                {(() => {
                  const dc = DIFF_COLOR[selectedLesson.difficulty] ?? DIFF_COLOR.intermediate;
                  return <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: dc.bg, color: dc.text, fontWeight: "600" }}>{DIFF_LABEL[selectedLesson.difficulty] ?? selectedLesson.difficulty}</span>;
                })()}
                <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{selectedLesson.provider}</span>
                <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{fmtDate(selectedLesson.created_at)}</span>
              </div>
            </div>

            {/* Detail body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
              {!lessonDetail ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100px", color: "var(--color-text-muted)", fontSize: "12px" }}>불러오는 중...</div>
              ) : (
                <>
                  <div style={{ marginBottom: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "999px", background: "var(--color-primary-light)", color: "var(--color-primary)", fontWeight: "600" }}>
                      {LESSON_STATUS_LABELS[lessonDetail.status]}
                    </span>
                    {lessonDetail.owner_name && (
                      <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                        작성자: {lessonDetail.owner_name}
                      </span>
                    )}
                    <span style={{ fontSize: "11px", color: lessonDetail.reviewer_name ? "var(--color-text-muted)" : "var(--color-text-subtle)" }}>
                      검토자: {lessonDetail.reviewer_name ?? "미배정"}
                    </span>
                    {lessonDetail.assignment_mode && (
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          borderRadius: "999px",
                          background: lessonDetail.assignment_mode === "auto" ? "#DBEAFE" : "#FEF3C7",
                          color: lessonDetail.assignment_mode === "auto" ? "#1D4ED8" : "#92400E",
                          fontWeight: "700",
                        }}
                      >
                        {lessonDetail.assignment_mode === "auto" ? "자동 배정" : "수동 지정"}
                      </span>
                    )}
                    {lessonDetail.assignment_note && (
                      <span style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                        배정 메모: {lessonDetail.assignment_note}
                      </span>
                    )}
                    {lessonDetail.review_notes && (
                      <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                        검토 메모: {lessonDetail.review_notes}
                      </span>
                    )}
                  </div>

                  <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", marginBottom: "4px" }}>다음 액션</div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                      {lessonDetail.status === "draft" && "초안 상태입니다. 검토 요청으로 넘기거나 내용을 보완해 주세요."}
                      {lessonDetail.status === "in_review" && (canReviewCurrentLesson ? "검토 메모를 남기고 승인 또는 수정 요청을 진행해 주세요." : "검토중입니다. 검토자의 피드백을 기다려 주세요.")}
                      {lessonDetail.status === "needs_revision" && "수정 요청이 들어왔습니다. 코멘트와 검토 메모를 반영한 뒤 다시 검토 요청하세요."}
                      {lessonDetail.status === "approved" && "승인된 레슨입니다. 필요한 형식으로 내보내거나 발행 완료로 관리할 수 있습니다."}
                      {lessonDetail.status === "published" && "발행까지 완료된 레슨입니다. 필요하면 코멘트로 후속 의견을 남길 수 있습니다."}
                    </div>
                  </div>

                  <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", marginBottom: "4px" }}>공유 링크</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "8px", lineHeight: 1.5 }}>
                      {recommendedLinkType === "review" && "지금은 검토 링크를 보내는 게 가장 자연스럽습니다."}
                      {recommendedLinkType === "comments" && "지금은 코멘트 링크를 보내 피드백 반영 지점을 바로 보여주는 게 좋습니다."}
                      {recommendedLinkType === "activities" && "지금은 활동 이력 링크로 전체 진행 맥락을 공유하는 편이 좋습니다."}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                      <button
                        onClick={() => copyLessonLink("review")}
                        style={{
                          padding: "8px 9px",
                          borderRadius: "8px",
                          border: `1px solid ${recommendedLinkType === "review" ? "var(--color-primary)" : "var(--color-border)"}`,
                          background: copiedLinkType === "review" || recommendedLinkType === "review" ? "var(--color-primary-light)" : "var(--color-surface)",
                          color: copiedLinkType === "review" || recommendedLinkType === "review" ? "var(--color-primary)" : "var(--color-text-muted)",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        {copiedLinkType === "review" ? "복사됨" : recommendedLinkType === "review" ? "검토 링크 추천" : "검토 링크"}
                      </button>
                      <button
                        onClick={() => copyLessonLink("comments")}
                        style={{
                          padding: "8px 9px",
                          borderRadius: "8px",
                          border: `1px solid ${recommendedLinkType === "comments" ? "var(--color-primary)" : "var(--color-border)"}`,
                          background: copiedLinkType === "comments" || recommendedLinkType === "comments" ? "var(--color-primary-light)" : "var(--color-surface)",
                          color: copiedLinkType === "comments" || recommendedLinkType === "comments" ? "var(--color-primary)" : "var(--color-text-muted)",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        {copiedLinkType === "comments" ? "복사됨" : recommendedLinkType === "comments" ? "코멘트 링크 추천" : "코멘트 링크"}
                      </button>
                      <button
                        onClick={() => copyLessonLink("activities")}
                        style={{
                          padding: "8px 9px",
                          borderRadius: "8px",
                          border: `1px solid ${recommendedLinkType === "activities" ? "var(--color-primary)" : "var(--color-border)"}`,
                          background: copiedLinkType === "activities" || recommendedLinkType === "activities" ? "var(--color-primary-light)" : "var(--color-surface)",
                          color: copiedLinkType === "activities" || recommendedLinkType === "activities" ? "var(--color-primary)" : "var(--color-text-muted)",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        {copiedLinkType === "activities" ? "복사됨" : recommendedLinkType === "activities" ? "이력 링크 추천" : "이력 링크"}
                      </button>
                    </div>
                  </div>

                  {(isOwner || canReviewCurrentLesson) && (
                    <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>
                        {isOwner && !canReviewCurrentLesson ? "내 레슨 액션" : canReviewCurrentLesson && !isOwner ? "검토 액션" : "협업 액션"}
                      </div>
                      <div style={{ display: "grid", gap: "6px" }}>
                        {isOwner && (lessonDetail.status === "draft" || lessonDetail.status === "needs_revision") && (
                          <button
                            onClick={() => updateReview("in_review", { promptForNotes: false })}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "8px",
                              border: "none",
                              background: "var(--color-primary)",
                              color: "#fff",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            {lessonDetail.status === "needs_revision" ? "수정 반영 후 재검토 요청" : "검토 요청 보내기"}
                          </button>
                        )}

                        {isOwner && lessonDetail.status === "in_review" && (
                          <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                            현재 검토 진행 중입니다. 급하게 수정이 필요하면 코멘트로 맥락을 남기고 새 버전으로 다시 저장하세요.
                          </div>
                        )}

                        {canReviewCurrentLesson && lessonDetail.status === "in_review" && (
                          <div style={{ display: "grid", gap: "8px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                              <button
                                onClick={() => updateReview("needs_revision", { promptForNotes: true, promptMessage: "수정 요청 메모를 남겨주세요." })}
                                style={{ padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: "12px", cursor: "pointer" }}
                              >
                                수정 요청
                              </button>
                              <button
                                onClick={() => updateReview("approved", { promptForNotes: true, promptMessage: "승인 메모를 남겨주세요. (선택)" })}
                                style={{ padding: "9px 10px", borderRadius: "8px", border: "none", background: "#E0E7FF", color: "#3730A3", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}
                              >
                                승인
                              </button>
                            </div>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {reviewTemplates.approved.map((template, index) => (
                                <button
                                  key={`detail-approved-template-${selectedLesson.id}-${index}`}
                                  onClick={() => updateReviewWithTemplate("approved", "승인 메모를 확인해 주세요.", template)}
                                  title={template}
                                  style={{
                                    padding: "5px 8px",
                                    borderRadius: "999px",
                                    border: "1px solid #C7D2FE",
                                    background: "#EEF2FF",
                                    color: "#3730A3",
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                  }}
                                >
                                  승인 템플릿
                                </button>
                              ))}
                              {reviewTemplates.needs_revision.map((template, index) => (
                                <button
                                  key={`detail-revision-template-${selectedLesson.id}-${index}`}
                                  onClick={() => updateReviewWithTemplate("needs_revision", "수정 요청 메모를 확인해 주세요.", template)}
                                  title={template}
                                  style={{
                                    padding: "5px 8px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--color-border)",
                                    background: "var(--color-surface)",
                                    color: "var(--color-text-muted)",
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                  }}
                                >
                                  수정 템플릿
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <DetailSection title="📖 지문" content={lessonDetail.package.passage} />
                  <DetailSection title={`❓ 독해 문제 (${lessonDetail.package.reading.questions.length}문항)`} content={lessonDetail.package.reading.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />
                  <DetailSection title={`📝 어휘 (${lessonDetail.package.vocabulary.words.length}단어)`} content={lessonDetail.package.vocabulary.words.map((w) => `• ${w.word}: ${w.definition}`).join("\n")} />
                  <DetailSection title="📐 문법 포인트" content={`${lessonDetail.package.grammar.focusPoint}\n\n${lessonDetail.package.grammar.explanation}`} />
                  <DetailSection title="✍️ 쓰기 과제" content={lessonDetail.package.writing.prompt} />
                  <DetailSection title={`📊 평가지 (${lessonDetail.package.assessment.totalPoints}점)`} content={lessonDetail.package.assessment.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />

                  <DetailSection
                    title={`💬 코멘트 (${comments.length})`}
                    content={comments.length === 0 ? "아직 코멘트가 없습니다." : comments.map((comment) => `• ${comment.author_name ?? "사용자"}${comment.author_role ? ` (${comment.author_role})` : ""}\n${new Date(comment.created_at).toLocaleString("ko-KR")}\n${comment.body}`).join("\n\n")}
                    open={activePanel === "comments"}
                    onToggle={() => setActivePanel((prev) => prev === "comments" ? null : "comments")}
                  />

                  <DetailSection
                    title={`🕘 활동 이력 (${activities.length})`}
                    content={
                      activities.length === 0
                        ? "아직 기록된 활동이 없습니다."
                        : activities.map(formatActivityLine).join("\n\n")
                    }
                    open={activePanel === "activities"}
                    onToggle={() => setActivePanel((prev) => prev === "activities" ? null : "activities")}
                  />

                  <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder={canReviewCurrentLesson ? "검토 코멘트 남기기" : isOwner ? "수정 메모나 질문 남기기" : "코멘트 남기기"}
                      style={{ flex: 1, minHeight: "70px", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--color-border-strong)", fontSize: "12px", fontFamily: "inherit", resize: "vertical" }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <button onClick={addComment} style={{ padding: "8px 10px", borderRadius: "8px", border: "none", background: "var(--color-primary)", color: "#fff", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>코멘트</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Export buttons */}
            <div style={{ padding: "11px 14px", borderTop: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", marginBottom: "7px" }}>내보내기</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
                {([
                  { label: "학생용 PDF",  type: "student" as const, format: "pdf"  as const },
                  ...(canExportTeacher ? [{ label: "교사용 PDF",  type: "teacher" as const, format: "pdf"  as const }] : []),
                  { label: "학생용 DOCX", type: "student" as const, format: "docx" as const },
                  ...(canExportTeacher ? [{ label: "교사용 DOCX", type: "teacher" as const, format: "docx" as const }] : []),
                ]).map(({ label, type, format }) => {
                  const busy = exporting === `${type}-${format}`;
                  return (
                    <button
                      key={label}
                      disabled={!lessonDetail || !!exporting}
                      onClick={() => handleExport(type, format)}
                      style={{
                        padding: "7px 6px", borderRadius: "6px",
                        border: "1px solid var(--color-border)", background: "var(--color-surface)",
                        color: lessonDetail ? "var(--color-text-muted)" : "var(--color-text-subtle)",
                        fontSize: "10px", fontWeight: "500",
                        cursor: lessonDetail && !exporting ? "pointer" : "not-allowed",
                        transition: ".15s",
                      }}
                      onMouseOver={(e) => {
                        if (!lessonDetail || exporting) return;
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-primary)";
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-primary)";
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--color-primary-light)";
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface)";
                      }}
                    >
                      {busy ? "⏳ 생성 중..." : label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function ProjectItem({ active, label, code, count, onClick, icon }: {
  active: boolean; label: string; code?: string; count: number; onClick: () => void; icon: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "6px 8px", borderRadius: "6px", cursor: "pointer", marginBottom: "1px",
        background: active ? "var(--color-primary-light)" : "transparent",
        transition: ".12s",
      }}
      onMouseOver={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg)"; }}
      onMouseOut={(e) =>  { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <span style={{ fontSize: "13px", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: "12px", color: active ? "var(--color-primary)" : "var(--color-text)", flex: 1, fontWeight: active ? "600" : "400", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
        {code && <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginLeft: "4px" }}>({code})</span>}
      </span>
      <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function DetailSection({
  title,
  content,
  open,
  onToggle,
}: {
  title: string;
  content: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const resolvedOpen = open ?? internalOpen;
  return (
    <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "7px", overflow: "hidden", marginBottom: "8px" }}>
      <div onClick={() => onToggle ? onToggle() : setInternalOpen((v) => !v)} style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "var(--color-surface)", borderBottom: resolvedOpen ? "1px solid var(--color-border)" : "none" }}>
        <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>{title}</span>
        <span style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>{resolvedOpen ? "▾" : "▸"}</span>
      </div>
      {resolvedOpen && (
        <div style={{ padding: "10px", fontSize: "11px", color: "var(--color-text-muted)", lineHeight: "1.7", whiteSpace: "pre-wrap", maxHeight: "160px", overflowY: "auto" }}>
          {content}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: number;
  helper: string;
  tone: "neutral" | "warning" | "success";
}) {
  const toneStyles = {
    neutral: { bg: "var(--color-bg)", border: "var(--color-border)", text: "var(--color-text)" },
    warning: { bg: "#FFF7ED", border: "#FED7AA", text: "#C2410C" },
    success: { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D" },
  }[tone];

  return (
    <div style={{ padding: "10px", borderRadius: "9px", background: toneStyles.bg, border: `1px solid ${toneStyles.border}` }}>
      <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: "700", color: toneStyles.text, marginBottom: "2px" }}>{value}</div>
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>{helper}</div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "11px" }}>
      <span style={{ color: "var(--color-text-subtle)" }}>{label}</span>
      <span style={{ color: muted ? "var(--color-text-subtle)" : "var(--color-text-muted)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function formatActivityLine(activity: LessonActivity) {
  const actor = activity.actor_name ?? "시스템";
  let action = LESSON_ACTIVITY_LABELS[activity.action] ?? activity.action;
  const stamp = new Date(activity.created_at).toLocaleString("ko-KR");
  const details: string[] = [];

  if (activity.action === "reviewer_assigned") {
    if (activity.metadata?.previous_reviewer_name) {
      action = "검토자 재배정";
    } else if (activity.metadata?.note?.includes("자동 배정")) {
      action = "검토자 자동 배정";
    } else {
      action = "검토자 지정";
    }
  }

  if (activity.metadata?.from_status || activity.metadata?.to_status) {
    details.push(
      `${activity.metadata.from_status ?? "없음"} → ${activity.metadata.to_status ?? "없음"}`
    );
  }

  if (activity.metadata?.reviewer_name) {
    if (activity.action === "reviewer_assigned" && activity.metadata?.note?.includes("자동 배정")) {
      details.push(`자동 배정 검토자: ${activity.metadata.reviewer_name}`);
    } else {
      details.push(`검토자: ${activity.metadata.reviewer_name}`);
    }
  }

  if (activity.metadata?.previous_reviewer_name) {
    details.push(`이전 검토자: ${activity.metadata.previous_reviewer_name}`);
  }

  if (activity.metadata?.template_used && activity.metadata?.template_text) {
    details.push(
      `템플릿 사용${activity.metadata.template_kind ? ` (${activity.metadata.template_kind})` : ""}: ${activity.metadata.template_text}`
    );
  }

  if (activity.metadata?.note) {
    details.push(`사유: ${activity.metadata.note}`);
  }

  return `• ${actor}${activity.actor_role ? ` (${activity.actor_role})` : ""}\n${stamp}\n${action}${details.length > 0 ? `\n${details.join("\n")}` : ""}`;
}
