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
import { AUTO_DOCUMENT_TEMPLATE_ID, DEFAULT_DOCUMENT_TEMPLATES, resolveDocumentTemplate } from "@/lib/documentTemplates";
import { applyTemplateContentLimits, getTemplateImageItems } from "@/lib/documentTemplateRender";
import { DEFAULT_IMAGE_PROMPT_PRESETS } from "@/lib/imagePrompts";
import { getWritingTasks } from "@/lib/workflows/lesson/types";

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
  delete_request_pending?: boolean;
  delete_request_requested_at?: string | null;
  delete_request_requester_id?: string | null;
}

interface LessonDetailResponse {
  package: LessonPackage;
  status: LessonStatus;
  review_notes?: string | null;
  owner_name?: string | null;
  reviewer_name?: string | null;
  reviewer_id?: string | null;
  project_id?: string | null;
  assignment_mode?: "auto" | "manual" | null;
  assignment_note?: string | null;
  delete_request_pending?: boolean;
  delete_request_requested_at?: string | null;
  delete_request_requester_id?: string | null;
}

interface ImagePromptPreset {
  id: string;
  name: string;
  prompt: string;
}

interface GeneratedPassageImage {
  id: string;
  prompt: string;
  presetId?: string | null;
  url: string;
  storagePath?: string;
  createdAt: string;
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

const LIBRARY_VIEW_MODE_KEY = "cyj-library:view-mode";

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

async function getApiErrorMessage(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.error ?? fallback;
}

function getOwnerDisplayName(name?: string | null) {
  return name?.trim() ? name : "이름 미등록";
}

function getReviewerDisplayName(name?: string | null) {
  return name?.trim() ? name : "자동 배정 대기";
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
  initialDeleteRequestOnly = false,
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
  initialDeleteRequestOnly?: boolean;
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
  const [deleteRequestOnly, setDeleteRequestOnly] = useState(initialDeleteRequestOnly);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [imagePrompts, setImagePrompts] = useState<ImagePromptPreset[]>(DEFAULT_IMAGE_PROMPT_PRESETS);
  const [selectedImagePromptId, setSelectedImagePromptId] = useState(DEFAULT_IMAGE_PROMPT_PRESETS[0]?.id ?? "");
  const [imagePromptText, setImagePromptText] = useState(DEFAULT_IMAGE_PROMPT_PRESETS[0]?.prompt ?? "");
  const [imageRevisionText, setImageRevisionText] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSavingLessonPackage, setIsSavingLessonPackage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const detailTemplate = useMemo(() => {
    if (!lessonDetail) return null;
    if (!lessonDetail.package.documentTemplate) {
      return resolveDocumentTemplate(DEFAULT_DOCUMENT_TEMPLATES, AUTO_DOCUMENT_TEMPLATE_ID);
    }
    return resolveDocumentTemplate(
      [lessonDetail.package.documentTemplate, ...DEFAULT_DOCUMENT_TEMPLATES],
      lessonDetail.package.documentTemplate.id
    );
  }, [lessonDetail?.package.documentTemplate]);
  const effectiveDetailPackage = useMemo(() => {
    if (!lessonDetail) return null;
    const template = lessonDetail.package.documentTemplate
      ? resolveDocumentTemplate(
          [lessonDetail.package.documentTemplate, ...DEFAULT_DOCUMENT_TEMPLATES],
          lessonDetail.package.documentTemplate.id
        )
      : resolveDocumentTemplate(DEFAULT_DOCUMENT_TEMPLATES, AUTO_DOCUMENT_TEMPLATE_ID);
    return applyTemplateContentLimits(lessonDetail.package, template);
  }, [lessonDetail]);
  const detailTemplateImageItems = useMemo(
    () => (detailTemplate ? getTemplateImageItems(detailTemplate) : []),
    [detailTemplate]
  );

  // Refs to break callback dependency cycles (lessons → loadLessonDetail → loadLessons → setLessons → ...)
  const lessonsRef = useRef<LessonSummary[]>([]);
  const selectedLessonRef = useRef<LessonSummary | null>(null);
  useEffect(() => { lessonsRef.current = lessons; }, [lessons]);
  useEffect(() => { selectedLessonRef.current = selectedLesson; }, [selectedLesson]);

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
      lessonsRef.current.find((item) => item.id === lessonId) ??
      selectedLessonRef.current;

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
      project_id: data.lesson?.project_id ?? nextSummary?.project_id ?? null,
      assignment_mode: data.lesson?.assignment_mode ?? null,
      assignment_note: data.lesson?.assignment_note ?? null,
      delete_request_pending: Boolean(data.lesson?.delete_request_pending),
      delete_request_requested_at: data.lesson?.delete_request_requested_at ?? null,
      delete_request_requester_id: data.lesson?.delete_request_requester_id ?? null,
    });
    setComments(data.comments ?? []);
    setActivities(data.activities ?? []);
  }, []); // No deps — uses refs to avoid identity churn

  const loadLessonDetailRef = useRef(loadLessonDetail);
  useEffect(() => { loadLessonDetailRef.current = loadLessonDetail; }, [loadLessonDetail]);

  const loadLessons = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      if (selectedProject) params.set("project_id", selectedProject);
      if (search)          params.set("search", search);
      if (favOnly)         params.set("favorite", "true");
      if (canManageReview) params.set("scope", scope);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (reassignedFilter !== "all") params.set("reassigned", reassignedFilter);

      const res = await fetch(`/api/lessons?${params}`);
      if (!res.ok) {
        let message = `레슨 목록을 불러오지 못했습니다 (HTTP ${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error) message = errJson.error;
        } catch {}
        console.error("[Library] loadLessons failed:", res.status, message);
        if (isMountedRef.current) setLoadError(message);
        return;
      }
      const { lessons: nextLessons } = await res.json();
      if (!isMountedRef.current) return;
      const lessonRows = nextLessons ?? [];
      setLessons(lessonRows);
      setLastUpdatedAt(new Date().toISOString());
      setLoadError(null);

      const currentSelected = selectedLessonRef.current;
      if (currentSelected) {
        const refreshed = lessonRows.find((l: LessonSummary) => l.id === currentSelected.id) ?? null;
        if (refreshed) void loadLessonDetailRef.current(refreshed.id, refreshed);
      }
    } catch (err) {
      console.error("[Library] loadLessons error:", err);
      if (isMountedRef.current) {
        setLoadError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다");
      }
    } finally {
      if (isMountedRef.current) {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [selectedProject, search, favOnly, scope, canManageReview, statusFilter, reassignedFilter]);

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
    fetch("/api/system-settings/image-prompts")
      .then((res) => res.json())
      .then(({ prompts }) => {
        if (!Array.isArray(prompts) || prompts.length === 0) return;
        setImagePrompts(prompts);
        setSelectedImagePromptId(prompts[0].id);
        setImagePromptText(prompts[0].prompt);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(LIBRARY_VIEW_MODE_KEY);
    if (saved === "table" || saved === "card") {
      setViewMode(saved);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);
  useEffect(() => {
    const params = new URLSearchParams();

    if (canManageReview && scope !== "all") params.set("scope", scope);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (reassignedFilter !== "all") params.set("reassigned", reassignedFilter);
    if (favOnly) params.set("favorite", "true");
    if (search.trim()) params.set("search", search.trim());
    if (selectedProject) params.set("project_id", selectedProject);
    if (deleteRequestOnly) params.set("delete_requests", "true");
    if (selectedLesson?.id) params.set("lesson_id", selectedLesson.id);
    if (selectedLesson?.id && activePanel) params.set("panel", activePanel);

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [activePanel, canManageReview, deleteRequestOnly, favOnly, pathname, reassignedFilter, router, scope, search, selectedLesson?.id, selectedProject, statusFilter]);

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
    setImageError(null);
    setDetailActionError(null);
    setImageRevisionText("");
    await loadLessonDetail(lesson.id, lesson);
  }

  // ── Export lesson ──────────────────────────────────────────
  const [exporting, setExporting] = useState<string | null>(null);

  function handleSelectImagePrompt(presetId: string) {
    setSelectedImagePromptId(presetId);
    const preset = imagePrompts.find((item) => item.id === presetId);
    if (preset) setImagePromptText(preset.prompt);
  }

  async function saveLessonPackage(nextPackage: LessonPackage) {
    if (!selectedLesson || !lessonDetail) return;
    setIsSavingLessonPackage(true);
    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${selectedLesson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: nextPackage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "이미지 저장 실패");
      }
      setLessonDetail((prev) => prev ? ({ ...prev, package: nextPackage }) : prev);
      dispatchInboxSync("lesson_saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "레슨 저장 중 오류가 발생했습니다.";
      setDetailActionError(message);
      throw error;
    } finally {
      setIsSavingLessonPackage(false);
    }
  }

  async function saveGeneratedImages(nextImages: GeneratedPassageImage[]) {
    if (!lessonDetail) return;
    await saveLessonPackage({
      ...lessonDetail.package,
      generatedImages: nextImages,
    });
  }

  async function updateSavedTemplateImageBinding(itemId: string, imageIndex: number | null, imageId?: string | null) {
    if (!lessonDetail || !detailTemplate || isSavingLessonPackage) return;
    const nextTemplate = {
      ...detailTemplate,
      pages: detailTemplate.pages.map((page) => ({
        ...page,
        items: page.items.map((item) =>
          item.id === itemId
            ? { ...item, imageBindingIndex: imageIndex, imageBindingId: imageId ?? null }
            : item
        ),
      })),
    };

    try {
      await saveLessonPackage({
        ...lessonDetail.package,
        documentTemplate: nextTemplate,
      });
    } catch {}
  }

  async function handleGenerateLibraryImage(mode: "new" | "revise", imageId?: string) {
    if (!lessonDetail || !selectedLesson) return;
    const prompt = imagePromptText.trim();
    if (!prompt) {
      setImageError("이미지 프롬프트를 입력해 주세요.");
      return;
    }

    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lessonDetail.package.title,
          passage: lessonDetail.package.passage,
          prompt,
          revision: mode === "revise" ? imageRevisionText : undefined,
          presetId: selectedImagePromptId || null,
          previousImageId: imageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "이미지 생성 실패");
      }

      const nextImage = data.image as GeneratedPassageImage;
      const currentImages = lessonDetail.package.generatedImages ?? [];
      const nextImages =
        mode === "revise" && imageId
          ? [nextImage, ...currentImages.filter((image) => image.id !== imageId)]
          : [nextImage, ...currentImages];
      await saveGeneratedImages(nextImages);
      setImageRevisionText("");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "이미지 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGeneratingImage(false);
    }
  }

  async function handleExport(type: "student" | "teacher", format: "pdf" | "docx") {
    if (!lessonDetail) return;
    const key = `${type}-${format}`;
    setExporting(key);
    setDetailActionError(null);
    try {
      const fname = safeFilename(lessonDetail.package.title);
      const label = type === "teacher" ? "교사용" : "학생용";
      const template =
        lessonDetail.package.documentTemplate
          ? resolveDocumentTemplate(
              [lessonDetail.package.documentTemplate, ...DEFAULT_DOCUMENT_TEMPLATES],
              lessonDetail.package.documentTemplate.id
            )
          : resolveDocumentTemplate(DEFAULT_DOCUMENT_TEMPLATES, AUTO_DOCUMENT_TEMPLATE_ID);
      if (format === "pdf") {
        const { generatePdf } = await import("@/lib/export/generatePdf");
        const blob = await generatePdf(lessonDetail.package, type, template);
        downloadBlob(blob, `${fname}_${label}_${template.id}.pdf`);
      } else {
        const { generateDocx } = await import("@/lib/export/generateDocx");
        const blob = await generateDocx(lessonDetail.package, type, template);
        downloadBlob(blob, `${fname}_${label}_${template.id}.docx`);
      }
    } catch (e) {
      console.error("Export failed:", e);
      setDetailActionError(e instanceof Error ? e.message : "내보내기 중 오류가 발생했습니다.");
    } finally {
      setExporting(null);
    }
  }

  async function addComment() {
    if (!selectedLesson || !commentDraft.trim()) return;
    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${selectedLesson.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentDraft }),
      });
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "코멘트 저장 중 오류가 발생했습니다."));
        return;
      }
      const { comment } = await res.json();
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
      dispatchInboxSync("lesson_commented");
      await selectLesson(selectedLesson);
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "코멘트 저장 중 오류가 발생했습니다.");
    }
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
    const confirmMessage =
      status === "approved"
        ? "이 레슨을 승인할까요?"
        : status === "published"
          ? "이 레슨을 발행 완료로 처리할까요?"
          : "검토 상태를 변경할까요?";
    const shouldPrompt = options?.promptForNotes ?? status !== "approved";
    const reviewNotes = shouldPrompt
      ? window.prompt(options?.promptMessage ?? "검토 메모를 남겨주세요.", lessonDetail?.review_notes ?? "")
      : lessonDetail?.review_notes ?? null;
    if (shouldPrompt && reviewNotes === null) return;
    if (!shouldPrompt && !window.confirm(confirmMessage)) return;
    setDetailActionError(null);
    try {
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
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "검토 상태 변경 중 오류가 발생했습니다."));
        return;
      }
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
      await loadLessons({ silent: true });
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "검토 상태 변경 중 오류가 발생했습니다.");
    }
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
    const shouldPrompt = status !== "approved";
    const reviewNotes = shouldPrompt ? window.prompt(promptMessage, lesson.review_notes ?? "") : lesson.review_notes ?? null;
    if (shouldPrompt && reviewNotes === null) return;
    if (!shouldPrompt && !window.confirm(`"${lesson.title}" 레슨을 승인할까요?`)) return;
    setDetailActionError(null);
    try {
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
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "카드 검토 상태 변경 중 오류가 발생했습니다."));
        return;
      }

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
      await loadLessons({ silent: true });
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "카드 검토 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function updateLessonMetadata(
    lesson: LessonSummary,
    updates: { title?: string; project_id?: string | null }
  ) {
    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "레슨 정보 저장 중 오류가 발생했습니다."));
        return null;
      }
      const { lesson: updatedLesson } = await res.json();
      dispatchInboxSync("lesson_saved");
      setLessons((prev) =>
        prev.map((item) =>
          item.id === updatedLesson.id
            ? {
                ...item,
                title: updatedLesson.title,
                project_id: updatedLesson.project_id ?? null,
              }
            : item
        )
      );
      if (selectedLesson?.id === lesson.id) {
        setSelectedLesson((prev) =>
          prev
            ? {
                ...prev,
                title: updatedLesson.title,
                project_id: updatedLesson.project_id ?? null,
              }
            : prev
        );
        setLessonDetail((prev) =>
          prev
            ? {
                ...prev,
                project_id: updatedLesson.project_id ?? null,
                package: {
                  ...prev.package,
                  title: updatedLesson.title,
                },
              }
            : prev
        );
      }
      await loadLessons({ silent: true });
      return updatedLesson;
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "레슨 정보 저장 중 오류가 발생했습니다.");
      return null;
    }
  }

  async function renameLesson(lesson: LessonSummary) {
    const nextTitle = window.prompt("레슨 이름을 수정해 주세요.", lesson.title);
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === lesson.title) return;
    await updateLessonMetadata(lesson, { title: trimmed });
  }

  async function assignLessonProject(lesson: LessonSummary) {
    const projectGuide = projects.map((project) => `${project.id}: ${project.name}`).join("\n");
    const nextProjectId = window.prompt(
      `프로젝트를 배정해 주세요.\n비워 두면 미배정으로 변경됩니다.\n\n사용 가능한 프로젝트 ID:\n${projectGuide || "(등록된 프로젝트 없음)"}`,
      lesson.project_id ?? ""
    );
    if (nextProjectId === null) return;
    const trimmed = nextProjectId.trim();
    if (trimmed && !projects.some((project) => project.id === trimmed)) {
      setDetailActionError("유효한 프로젝트 ID를 입력해 주세요.");
      return;
    }
    await updateLessonMetadata(lesson, { project_id: trimmed || null });
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
    const shouldPrompt = status !== "approved";
    const reviewNotes = shouldPrompt ? window.prompt(promptMessage, "") : "";
    if (shouldPrompt && reviewNotes === null) return;
    if (!shouldPrompt && !window.confirm(`${selectedReviewIds.length}개 레슨을 승인할까요?`)) return;
    setDetailActionError(null);
    try {
      const responses = await Promise.all(
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

      const failedResponse = responses.find((res) => !res.ok);
      if (failedResponse) {
        setDetailActionError(await getApiErrorMessage(failedResponse, "일괄 검토 처리 중 오류가 발생했습니다."));
        return;
      }

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
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "일괄 검토 처리 중 오류가 발생했습니다.");
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
      promptForNotes: status !== "approved",
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

  async function requestDelete(lesson: LessonSummary) {
    if (!window.confirm(`"${lesson.title}" 레슨의 삭제를 요청할까요? 최고관리자에게 삭제 요청이 전달됩니다.`)) {
      return;
    }
    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}/delete-request`, {
        method: "POST",
      });
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "삭제 요청 중 오류가 발생했습니다."));
        return;
      }

      const data = await res.json();
      dispatchInboxSync("lesson_delete_requested");
      setLessons((prev) =>
        prev.map((item) =>
          item.id === lesson.id
            ? {
                ...item,
                delete_request_pending: Boolean(data.delete_request_pending),
                delete_request_requested_at: data.delete_request_requested_at ?? null,
                delete_request_requester_id: data.delete_request_requester_id ?? null,
              }
            : item
        )
      );

      if (selectedLesson?.id === lesson.id) {
        setSelectedLesson((prev) =>
          prev
            ? {
                ...prev,
                delete_request_pending: Boolean(data.delete_request_pending),
                delete_request_requested_at: data.delete_request_requested_at ?? null,
                delete_request_requester_id: data.delete_request_requester_id ?? null,
              }
            : prev
        );
        setLessonDetail((prev) =>
          prev
            ? {
                ...prev,
                delete_request_pending: Boolean(data.delete_request_pending),
                delete_request_requested_at: data.delete_request_requested_at ?? null,
                delete_request_requester_id: data.delete_request_requester_id ?? null,
              }
            : prev
        );
      }
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "삭제 요청 중 오류가 발생했습니다.");
    }
  }

  async function cancelDeleteRequest(lesson: LessonSummary) {
    if (!window.confirm(`"${lesson.title}" 레슨의 삭제 요청을 취소할까요?`)) {
      return;
    }
    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}/delete-request`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "삭제 요청 취소 중 오류가 발생했습니다."));
        return;
      }

      dispatchInboxSync("lesson_delete_request_cancelled");
      setLessons((prev) =>
        prev.map((item) =>
          item.id === lesson.id
            ? {
                ...item,
                delete_request_pending: false,
                delete_request_requested_at: null,
                delete_request_requester_id: null,
              }
            : item
        )
      );

      if (selectedLesson?.id === lesson.id) {
        setSelectedLesson((prev) =>
          prev
            ? {
                ...prev,
                delete_request_pending: false,
                delete_request_requested_at: null,
                delete_request_requester_id: null,
              }
            : prev
        );
        setLessonDetail((prev) =>
          prev
            ? {
                ...prev,
                delete_request_pending: false,
                delete_request_requested_at: null,
                delete_request_requester_id: null,
              }
            : prev
        );
      }
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "삭제 요청 취소 중 오류가 발생했습니다.");
    }
  }

  async function deleteLesson(lesson: LessonSummary) {
    if (!window.confirm(`"${lesson.title}" 레슨을 정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setDetailActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}`, { method: "DELETE" });
      if (!res.ok) {
        setDetailActionError(await getApiErrorMessage(res, "레슨 삭제 중 오류가 발생했습니다."));
        return;
      }

      dispatchInboxSync("lesson_deleted");
      setLessons((prev) => prev.filter((item) => item.id !== lesson.id));
      if (selectedLesson?.id === lesson.id) {
        setSelectedLesson(null);
        setLessonDetail(null);
        setComments([]);
        setActivities([]);
        setActivePanel(null);
      }
    } catch (error) {
      setDetailActionError(error instanceof Error ? error.message : "레슨 삭제 중 오류가 발생했습니다.");
    }
  }

  const filteredLessons = deleteRequestOnly
    ? lessons.filter((lesson) => lesson.delete_request_pending)
    : lessons; // server-side filtering already applied
  const canShowReviewActions = canManageReview && (viewerRole === "admin" || viewerRole === "lead_teacher" || viewerRole === "reviewer");
  const isOwner = selectedLesson?.user_id === viewerId;
  const isAdmin = viewerRole === "admin";
  const canEditLessonPackage = Boolean(isOwner || canManageReview);
  const canReviewCurrentLesson =
    canShowReviewActions &&
    !!selectedLesson &&
    (viewerRole === "admin" || viewerRole === "lead_teacher" || selectedLesson.reviewer_id === viewerId);
  const canPublishCurrentLesson = Boolean(
    selectedLesson &&
      selectedLesson.status === "approved" &&
      (selectedLesson.user_id === viewerId || canManageReview)
  );
  const canRequestDeleteCurrentLesson = Boolean(selectedLesson && !isAdmin && selectedLesson.user_id === viewerId);
  const canCancelDeleteCurrentLesson =
    Boolean(
      selectedLesson?.delete_request_pending &&
        (isAdmin || selectedLesson?.delete_request_requester_id === viewerId)
    );
  const recommendedLinkType: "review" | "comments" | "activities" =
    lessonDetail?.status === "in_review"
      ? "review"
      : lessonDetail?.status === "needs_revision"
        ? "comments"
        : "activities";
  const draftCount = lessons.filter((lesson) => lesson.status === "draft" || lesson.status === "needs_revision").length;
  const reviewCount = lessons.filter((lesson) => lesson.status === "in_review").length;
  const approvedCount = lessons.filter((lesson) => lesson.status === "approved" || lesson.status === "published").length;
  const deleteRequestCount = lessons.filter((lesson) => lesson.delete_request_pending).length;
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
            onClick={() => {
              setSelectedProject(null);
              setDeleteRequestOnly(false);
            }}
            icon="📂"
          />
          <ProjectItem
            active={favOnly}
            label="즐겨찾기"
            count={lessons.filter((l) => l.isFavorite).length}
            onClick={() => {
              setFavOnly((v) => !v);
              setSelectedProject(null);
              setDeleteRequestOnly(false);
            }}
            icon="⭐"
          />
          <ProjectItem
            active={deleteRequestOnly}
            label="삭제 요청"
            count={deleteRequestCount}
            onClick={() => {
              setDeleteRequestOnly((v) => !v);
              setFavOnly(false);
              setSelectedProject(null);
            }}
            icon="🗑️"
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
              onClick={() => { setSelectedProject(p.id); setFavOnly(false); setDeleteRequestOnly(false); }}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px",
              borderRadius: "999px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("table")}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "none",
                background: viewMode === "table" ? "var(--color-primary-light)" : "transparent",
                color: viewMode === "table" ? "var(--color-primary)" : "var(--color-text-muted)",
                fontSize: "11px",
                fontWeight: "700",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              테이블형
            </button>
            <button
              type="button"
              onClick={() => setViewMode("card")}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "none",
                background: viewMode === "card" ? "var(--color-primary-light)" : "transparent",
                color: viewMode === "card" ? "var(--color-primary)" : "var(--color-text-muted)",
                fontSize: "11px",
                fontWeight: "700",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              카드형
            </button>
          </div>
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
          <button
            onClick={() => setDeleteRequestOnly((v) => !v)}
            style={{
              padding: "6px 10px",
              borderRadius: "999px",
              border: `1px solid ${deleteRequestOnly ? "#DC2626" : "var(--color-border)"}`,
              background: deleteRequestOnly ? "#FEF2F2" : "var(--color-surface)",
              color: deleteRequestOnly ? "#B91C1C" : "var(--color-text-muted)",
              fontSize: "11px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            삭제 요청 {deleteRequestCount}
          </button>
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

        {deleteRequestOnly && (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>삭제 요청 필터</span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "700",
                color: "#B91C1C",
                background: "#FEF2F2",
                padding: "4px 8px",
                borderRadius: "999px",
              }}
            >
              삭제 요청 {deleteRequestCount}건
            </span>
            <button
              onClick={() => setDeleteRequestOnly(false)}
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
          ) : loadError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "200px", gap: "10px", padding: "0 20px" }}>
              <div style={{ fontSize: "28px", opacity: .5 }}>⚠️</div>
              <div style={{ fontSize: "13px", color: "#B91C1C", fontWeight: "600", textAlign: "center" }}>레슨을 불러오지 못했습니다</div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", textAlign: "center", maxWidth: "320px", lineHeight: "1.5" }}>{loadError}</div>
              <button
                onClick={() => { setLoadError(null); void loadLessons(); }}
                style={{ marginTop: "4px", padding: "6px 14px", borderRadius: "6px", background: "var(--color-primary)", color: "#fff", border: "none", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}
              >
                다시 시도
              </button>
            </div>
          ) : filteredLessons.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "200px", gap: "10px", color: "var(--color-text-muted)" }}>
              <div style={{ fontSize: "28px", opacity: .4 }}>📚</div>
              <div style={{ fontSize: "13px" }}>레슨이 없습니다</div>
              <div style={{ fontSize: "12px" }}>스튜디오에서 레슨을 만들고 저장하면 여기 표시됩니다</div>
            </div>
          ) : viewMode === "table" ? (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                overflow: "hidden",
                background: "var(--color-surface)",
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
                  <thead>
                    <tr style={{ background: "var(--color-bg)" }}>
                      {["제목", "난이도", "상태", "저장자", "검토 담당", "생성일", "AI", "액션"].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "11px 12px",
                            borderBottom: "1px solid var(--color-border)",
                            textAlign: "left",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: "var(--color-text-subtle)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLessons.map((lesson) => {
                      const dc = DIFF_COLOR[lesson.difficulty] ?? DIFF_COLOR.intermediate;
                      const isActive = selectedLesson?.id === lesson.id;
                      return (
                        <tr
                          key={`table-${lesson.id}`}
                          onClick={() => selectLesson(lesson)}
                          style={{
                            background: isActive ? "rgba(79,70,229,.05)" : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)" }}>
                            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text)", lineHeight: 1.45 }}>
                              {lesson.title}
                            </div>
                            {lesson.tags?.length ? (
                              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
                                {lesson.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={`${lesson.id}-${tag}`}
                                    style={{
                                      fontSize: "10px",
                                      padding: "1px 6px",
                                      borderRadius: "999px",
                                      background: "var(--color-primary-light)",
                                      color: "var(--color-primary)",
                                    }}
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>
                            <span style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "999px", background: dc.bg, color: dc.text, fontWeight: "700" }}>
                              {DIFF_LABEL[lesson.difficulty] ?? lesson.difficulty}
                            </span>
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)" }}>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "999px", background: "var(--color-primary-light)", color: "var(--color-primary)", fontWeight: "700" }}>
                                {LESSON_STATUS_LABELS[lesson.status]}
                              </span>
                              {lesson.delete_request_pending && (
                                <span style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "999px", background: "#FEF2F2", color: "#B91C1C", fontWeight: "700" }}>
                                  삭제 요청
                                </span>
                              )}
                              {lesson.reassigned_badge && (
                                <span style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "999px", background: lesson.reassigned_badge === "to_me" ? "#DBEAFE" : "#FEF3C7", color: lesson.reassigned_badge === "to_me" ? "#1D4ED8" : "#92400E", fontWeight: "700" }}>
                                  {lesson.reassigned_badge === "to_me" ? "재배정됨" : "이동됨"}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)", fontSize: "12px", color: lesson.owner_name ? "var(--color-text)" : "var(--color-text-subtle)" }}>
                            {getOwnerDisplayName(lesson.owner_name)}
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)", fontSize: "12px", color: lesson.reviewer_name ? "var(--color-text)" : "var(--color-text-subtle)" }}>
                            {getReviewerDisplayName(lesson.reviewer_name)}
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)", fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {fmtDate(lesson.created_at)}
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)", fontSize: "11px", color: "var(--color-text-muted)" }}>
                            {lesson.provider}
                          </td>
                          <td style={{ padding: "12px", borderBottom: "1px solid var(--color-border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-start" }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyLessonLinkFromCard(lesson);
                                }}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "var(--color-text-muted)",
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                공유
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void renameLesson(lesson);
                                }}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "var(--color-text-muted)",
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                이름 수정
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void assignLessonProject(lesson);
                                }}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "var(--color-text-muted)",
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                프로젝트
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFav(lesson.id, lesson.isFavorite);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontSize: "15px",
                                  opacity: lesson.isFavorite ? 1 : 0.3,
                                }}
                              >
                                ⭐
                              </button>
                              {(isAdmin ||
                                (!isAdmin && lesson.user_id === viewerId) ||
                                (lesson.delete_request_pending &&
                                  (isAdmin || lesson.delete_request_requester_id === viewerId))) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isAdmin) {
                                      void deleteLesson(lesson);
                                      return;
                                    }
                                    if (lesson.delete_request_pending && lesson.delete_request_requester_id === viewerId) {
                                      void cancelDeleteRequest(lesson);
                                      return;
                                    }
                                    if (lesson.user_id === viewerId) {
                                      void requestDelete(lesson);
                                    }
                                  }}
                                  title={
                                    isAdmin
                                      ? "레슨 삭제"
                                      : lesson.delete_request_pending && lesson.delete_request_requester_id === viewerId
                                        ? "삭제 요청 취소"
                                        : "삭제 요청"
                                  }
                                  style={{
                                    width: "28px",
                                    height: "28px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: "999px",
                                    border: "1px solid #FECACA",
                                    background: "#FEF2F2",
                                    color: "#B91C1C",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                  }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                                    <path d="M2.5 3.2h8M5 1.8h3M4 3.2v6.3m2.5-6.3v6.3m2.5-6.3v6.3M3.4 3.2l.4 7.2c.03.52.46.93.98.93h3.84c.52 0 .95-.41.98-.93l.4-7.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                const canRequestDeleteCard = !isAdmin && lesson.user_id === viewerId;
                const canCancelDeleteCard =
                  Boolean(lesson.delete_request_pending && (isAdmin || lesson.delete_request_requester_id === viewerId));
                const isReviewSelected = selectedReviewIds.includes(lesson.id);
                return (
                  <div
                    key={lesson.id}
                    onClick={() => selectLesson(lesson)}
                    style={{
                      background: "var(--color-surface)",
                      border: `1.5px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                      borderRadius: "9px", padding: "14px",
                      display: "flex",
                      flexDirection: "column",
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
                              { value: "rename", label: "이름 수정" },
                              { value: "project", label: "프로젝트 배정" },
                              { value: "review", label: "검토 열기 링크" },
                              { value: "comments", label: "피드백 보기 링크" },
                              { value: "activities", label: "활동 이력 링크" },
                            ] as const).map((item) => (
                              <button
                                key={item.value}
                                onClick={() => {
                                  if (item.value === "rename") {
                                    void renameLesson(lesson);
                                  } else if (item.value === "project") {
                                    void assignLessonProject(lesson);
                                  } else {
                                    void copyLessonLinkFromCard(lesson, item.value);
                                  }
                                  setShareMenuLessonId(null);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "8px 10px",
                                  border: "none",
                                  borderBottom: item.value !== "activities" ? "1px solid var(--color-border)" : "none",
                                  background:
                                    item.value === "review" || item.value === "comments" || item.value === "activities"
                                      ? recommendedCardLinkType === item.value
                                        ? "var(--color-primary-light)"
                                        : "var(--color-surface)"
                                      : "var(--color-surface)",
                                  color:
                                    item.value === "review" || item.value === "comments" || item.value === "activities"
                                      ? recommendedCardLinkType === item.value
                                        ? "var(--color-primary)"
                                        : "var(--color-text-muted)"
                                      : "var(--color-text-muted)",
                                  fontSize: "11px",
                                  fontWeight:
                                    item.value === "review" || item.value === "comments" || item.value === "activities"
                                      ? recommendedCardLinkType === item.value
                                        ? "700"
                                        : "600"
                                      : "600",
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                {item.label}
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
                      {lesson.delete_request_pending && (
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 7px",
                            borderRadius: "4px",
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            fontWeight: "700",
                          }}
                        >
                          삭제 요청
                        </span>
                      )}
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
                      <MetaRow label="저장자" value={getOwnerDisplayName(lesson.owner_name)} muted={!lesson.owner_name} />
                      <MetaRow label="검토 담당" value={getReviewerDisplayName(lesson.reviewer_name)} muted={!lesson.reviewer_name} />
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

                    {lesson.delete_request_pending && lesson.delete_request_requested_at && (
                      <div style={{ fontSize: "10px", color: "#B91C1C", fontWeight: "700", marginTop: "10px" }}>
                        삭제 요청 접수 · {fmtDate(lesson.delete_request_requested_at)}
                      </div>
                    )}

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

                    {(isAdmin || canRequestDeleteCard || canCancelDeleteCard) && (
                      <div style={{ marginTop: "auto", paddingTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAdmin) {
                              void deleteLesson(lesson);
                              return;
                            }
                            if (lesson.delete_request_pending && canCancelDeleteCard) {
                              void cancelDeleteRequest(lesson);
                              return;
                            }
                            if (canRequestDeleteCard) {
                              void requestDelete(lesson);
                            }
                          }}
                          title={
                            isAdmin
                              ? "레슨 삭제"
                              : lesson.delete_request_pending && canCancelDeleteCard
                                ? "삭제 요청 취소"
                                : "삭제 요청"
                          }
                          style={{
                            width: "34px",
                            height: "34px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "999px",
                            border: "1px solid #FECACA",
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            cursor: "pointer",
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                            <path d="M3 3.7h9M5.5 2.2h4M4.6 3.7l.45 8.1c.03.58.51 1.03 1.08 1.03h4.22c.57 0 1.05-.45 1.08-1.03l.45-8.1M6 5.3v5.3m3-5.3v5.3m3-5.3v5.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
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
                    <span style={{ fontSize: "11px", color: lessonDetail.owner_name ? "var(--color-text-muted)" : "var(--color-text-subtle)" }}>
                      저장자: {getOwnerDisplayName(lessonDetail.owner_name)}
                    </span>
                    <span style={{ fontSize: "11px", color: lessonDetail.reviewer_name ? "var(--color-text-muted)" : "var(--color-text-subtle)" }}>
                      검토 담당: {getReviewerDisplayName(lessonDetail.reviewer_name)}
                    </span>
                    <span style={{ fontSize: "11px", color: lessonDetail.project_id ? "var(--color-text-muted)" : "var(--color-text-subtle)" }}>
                      프로젝트: {lessonDetail.project_id ? projects.find((project) => project.id === lessonDetail.project_id)?.name ?? "알 수 없음" : "미배정"}
                    </span>
                    {lessonDetail.package.documentTemplate?.name && (
                      <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                        템플릿: {lessonDetail.package.documentTemplate.name}
                      </span>
                    )}
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
                    {lessonDetail.delete_request_pending && (
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          borderRadius: "999px",
                          background: "#FEF2F2",
                          color: "#B91C1C",
                          fontWeight: "700",
                        }}
                      >
                        삭제 요청 접수
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
                      {lessonDetail.status === "in_review" && (canReviewCurrentLesson ? "검토 메모 없이도 바로 승인할 수 있고, 필요하면 수정 요청 메모를 남길 수 있습니다." : "검토중입니다. 검토 담당의 피드백을 기다려 주세요.")}
                      {lessonDetail.status === "needs_revision" && "수정 요청이 들어왔습니다. 코멘트와 검토 메모를 반영한 뒤 다시 검토 요청하세요."}
                      {lessonDetail.status === "approved" && "승인된 레슨입니다. 필요한 형식으로 내보내거나 발행 완료로 관리할 수 있습니다."}
                      {lessonDetail.status === "published" && "발행까지 완료된 레슨입니다. 필요하면 코멘트로 후속 의견을 남길 수 있습니다."}
                    </div>
                  </div>

                  {(isAdmin || canRequestDeleteCurrentLesson || canCancelDeleteCurrentLesson) && (
                    <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>
                        삭제 관리
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6, marginBottom: "8px" }}>
                        {isAdmin
                          ? "관리자는 레슨을 즉시 삭제할 수 있습니다."
                          : lessonDetail.delete_request_pending
                            ? "삭제 요청이 접수된 상태입니다. 필요하면 요청을 취소할 수 있습니다."
                            : "일반 사용자는 즉시 삭제 대신 최고관리자에게 삭제 요청을 보냅니다."}
                      </div>
                      {lessonDetail.delete_request_pending && lessonDetail.delete_request_requested_at && (
                        <div style={{ fontSize: "11px", color: "#B91C1C", fontWeight: "700", marginBottom: "8px" }}>
                          요청 일시: {fmtDate(lessonDetail.delete_request_requested_at)}
                        </div>
                      )}
                      <div style={{ display: "grid", gap: "6px" }}>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              if (selectedLesson) void deleteLesson(selectedLesson);
                            }}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "8px",
                              border: "1px solid #FCA5A5",
                              background: "#FEE2E2",
                              color: "#B91C1C",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            레슨 즉시 삭제
                          </button>
                        )}
                        {!isAdmin && canRequestDeleteCurrentLesson && !lessonDetail.delete_request_pending && (
                          <button
                            onClick={() => {
                              if (selectedLesson) void requestDelete(selectedLesson);
                            }}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "8px",
                              border: "1px solid #FECACA",
                              background: "#FEF2F2",
                              color: "#B91C1C",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            최고관리자에게 삭제 요청
                          </button>
                        )}
                        {!isAdmin && lessonDetail.delete_request_pending && canCancelDeleteCurrentLesson && (
                          <button
                            onClick={() => {
                              if (selectedLesson) void cancelDeleteRequest(selectedLesson);
                            }}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "8px",
                              border: "1px solid var(--color-border)",
                              background: "var(--color-surface)",
                              color: "var(--color-text-muted)",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            삭제 요청 취소
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>
                      레슨 관리
                    </div>
                    <div style={{ display: "grid", gap: "6px", marginBottom: "10px" }}>
                      <button
                        onClick={() => selectedLesson && void renameLesson(selectedLesson)}
                        style={{
                          padding: "9px 10px",
                          borderRadius: "8px",
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-text-muted)",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        레슨 이름 수정
                      </button>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)" }}>
                          프로젝트 폴더 배정
                        </span>
                        <select
                          value={selectedLesson?.project_id ?? ""}
                          onChange={(event) => {
                            if (!selectedLesson) return;
                            void updateLessonMetadata(selectedLesson, {
                              project_id: event.target.value || null,
                            });
                          }}
                          style={{
                            padding: "9px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-text)",
                            fontSize: "12px",
                            fontFamily: "inherit",
                          }}
                        >
                          <option value="">미배정</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", marginBottom: "4px" }}>공유 링크</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "8px", lineHeight: 1.5 }}>
                      {recommendedLinkType === "review" && "검토 담당이 바로 열어 승인/수정 요청을 볼 링크입니다."}
                      {recommendedLinkType === "comments" && "피드백과 코멘트만 바로 확인할 링크입니다."}
                      {recommendedLinkType === "activities" && "활동 이력 전체를 확인하는 링크입니다."}
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
                        {copiedLinkType === "review" ? "복사됨" : "검토 열기 링크"}
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
                        {copiedLinkType === "comments" ? "복사됨" : "피드백 보기 링크"}
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
                        {copiedLinkType === "activities" ? "복사됨" : "활동 이력 링크"}
                      </button>
                    </div>
                  </div>

                  {(isOwner || canReviewCurrentLesson || canPublishCurrentLesson) && (
                    <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>
                        {canPublishCurrentLesson
                          ? "완료 액션"
                          : isOwner && !canReviewCurrentLesson
                            ? "내 레슨 액션"
                            : canReviewCurrentLesson && !isOwner
                              ? "검토 액션"
                              : "협업 액션"}
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
                                onClick={() => updateReview("approved")}
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

                        {canPublishCurrentLesson && lessonDetail.status === "approved" && (
                          <button
                            onClick={() => updateReview("published", { promptForNotes: false })}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "8px",
                              border: "none",
                              background: "#DCFCE7",
                              color: "#166534",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            발행 완료 처리
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <DetailSection title="📖 지문" content={lessonDetail.package.passage} />
                  {lessonDetail.package.generatedImages && lessonDetail.package.generatedImages.length > 0 && (
                    <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "8px" }}>
                        🖼️ 생성 이미지 ({lessonDetail.package.generatedImages.length})
                      </div>
                      <div style={{ display: "grid", gap: "8px" }}>
                        {lessonDetail.package.generatedImages.map((image, index) => (
                          <div
                            key={image.id}
                            style={{
                              border: "1px solid var(--color-border)",
                              borderRadius: "8px",
                              background: "var(--color-bg)",
                              overflow: "hidden",
                            }}
                          >
                            <img
                              src={image.url}
                              alt={`생성 이미지 ${index + 1}`}
                              style={{ width: "100%", display: "block", background: "#fff" }}
                            />
                            <div style={{ padding: "8px", fontSize: "10px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>
                              {image.prompt}
                            </div>
                            {canEditLessonPackage && (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", padding: "0 8px 8px" }}>
                                <button
                                  onClick={() => void handleGenerateLibraryImage("revise", image.id)}
                                  disabled={isGeneratingImage || !imageRevisionText.trim()}
                                  style={{
                                    padding: "7px 8px",
                                    borderRadius: "7px",
                                    border: "1px solid var(--color-border)",
                                    background: "var(--color-surface)",
                                    color: "var(--color-text)",
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    cursor: isGeneratingImage || !imageRevisionText.trim() ? "not-allowed" : "pointer",
                                    opacity: isGeneratingImage || !imageRevisionText.trim() ? 0.6 : 1,
                                  }}
                                >
                                  부분 수정
                                </button>
                                <button
                                  onClick={() => void handleGenerateLibraryImage("new")}
                                  disabled={isGeneratingImage}
                                  style={{
                                    padding: "7px 8px",
                                    borderRadius: "7px",
                                    border: "1px solid #C7D2FE",
                                    background: "#EEF2FF",
                                    color: "#3730A3",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    cursor: isGeneratingImage ? "not-allowed" : "pointer",
                                    opacity: isGeneratingImage ? 0.6 : 1,
                                  }}
                                >
                                  새로 생성
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {canEditLessonPackage && detailTemplateImageItems.length > 0 && lessonDetail.package.generatedImages && lessonDetail.package.generatedImages.length > 0 && (
                    <div
                      style={{
                        marginBottom: "10px",
                        padding: "10px 11px",
                        borderRadius: "8px",
                        background: "#F8FBFF",
                        border: "1px solid #DBEAFE",
                        display: "grid",
                        gap: "10px",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: "#1D4ED8", marginBottom: "6px" }}>
                          템플릿 이미지 연결
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                          이 연결은 공용 템플릿을 바꾸는 것이 아니라, 현재 저장된 레슨의 템플릿 스냅샷에만 적용됩니다. 나중에 다시 열어도 같은 연결 상태로 이어집니다.
                        </div>
                      </div>
                      {detailTemplateImageItems.map(({ pageId, item }, blockIndex) => {
                        const boundIndex = item.imageBindingIndex ?? null;
                        const boundImage =
                          item.imageBindingId
                            ? lessonDetail.package.generatedImages?.find((image) => image.id === item.imageBindingId) ?? null
                            : boundIndex !== null && lessonDetail.package.generatedImages?.[boundIndex]
                              ? lessonDetail.package.generatedImages[boundIndex]
                              : null;
                        return (
                          <div
                            key={`library-image-binding-${item.id}`}
                            style={{
                              border: "1px solid var(--color-border)",
                              borderRadius: "8px",
                              background: "#fff",
                              padding: "10px",
                              display: "grid",
                              gap: "10px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>
                                  {item.label}
                                </div>
                                <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                                  {pageId} · 이미지 블록 {blockIndex + 1}
                                </div>
                              </div>
                              <div style={{ fontSize: "10px", fontWeight: "700", color: boundImage ? "#1D4ED8" : "var(--color-text-muted)" }}>
                                {boundImage
                                  ? `현재 연결: 생성 이미지 ${((lessonDetail.package.generatedImages ?? []).findIndex((image) => image.id === boundImage.id)) + 1}`
                                  : "현재 연결: 자동"}
                              </div>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={() => void updateSavedTemplateImageBinding(item.id, null, null)}
                                style={{
                                  padding: "10px",
                                  borderRadius: "10px",
                                border: `1px solid ${!boundImage ? "#93C5FD" : "var(--color-border)"}`,
                                background: !boundImage ? "#EFF6FF" : "var(--color-surface)",
                                color: !boundImage ? "#1D4ED8" : "var(--color-text)",
                                fontSize: "11px",
                                fontWeight: "700",
                                textAlign: "left",
                                cursor: isSavingLessonPackage ? "not-allowed" : "pointer",
                                opacity: isSavingLessonPackage ? 0.6 : 1,
                              }}
                              disabled={isSavingLessonPackage}
                            >
                                자동 연결
                                <div style={{ marginTop: "4px", fontSize: "10px", fontWeight: "500", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                                  이미지 블록 순서 기준으로 자동 연결합니다.
                                </div>
                              </button>
                              {lessonDetail.package.generatedImages?.map((image, imageIndex) => {
                                const active = boundImage?.id === image.id;
                                return (
                                  <button
                                    key={`${item.id}-${image.id}-library`}
                                    type="button"
                                    onClick={() => void updateSavedTemplateImageBinding(item.id, imageIndex, image.id)}
                                    style={{
                                      padding: "8px",
                                      borderRadius: "10px",
                                      border: `1px solid ${active ? "#93C5FD" : "var(--color-border)"}`,
                                      background: active ? "#EFF6FF" : "#fff",
                                      textAlign: "left",
                                      cursor: isSavingLessonPackage ? "not-allowed" : "pointer",
                                      opacity: isSavingLessonPackage ? 0.6 : 1,
                                    }}
                                    disabled={isSavingLessonPackage}
                                  >
                                    <img
                                      src={image.url}
                                      alt={`생성 이미지 ${imageIndex + 1}`}
                                      style={{
                                        width: "100%",
                                        aspectRatio: "4 / 3",
                                        objectFit: "cover",
                                        borderRadius: "8px",
                                        border: "1px solid var(--color-border)",
                                        background: "#F8FAFC",
                                      }}
                                    />
                                    <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: "700", color: active ? "#1D4ED8" : "var(--color-text)" }}>
                                      생성 이미지 {imageIndex + 1}
                                    </div>
                                    <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                                      {image.prompt}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {canEditLessonPackage && (
                    <div style={{ marginBottom: "10px", padding: "10px 11px", borderRadius: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>
                        이미지 재생성
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6, marginBottom: "8px" }}>
                        저장된 지문을 기준으로 이미지를 다시 만들 수 있습니다. 프리셋을 불러온 뒤 수정해서 새로 생성하거나, 현재 이미지에 수정 지시를 붙여 다시 만들 수 있습니다.
                      </div>
                      <div style={{ display: "grid", gap: "8px" }}>
                        <select
                          value={selectedImagePromptId}
                          onChange={(e) => handleSelectImagePrompt(e.target.value)}
                          disabled={isGeneratingImage}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "#fff",
                            fontSize: "12px",
                            color: "var(--color-text)",
                          }}
                        >
                          {imagePrompts.map((prompt) => (
                            <option key={prompt.id} value={prompt.id}>
                              {prompt.name}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={imagePromptText}
                          onChange={(e) => setImagePromptText(e.target.value)}
                          disabled={isGeneratingImage}
                          rows={4}
                          placeholder="이미지 생성 프롬프트"
                          style={{
                            width: "100%",
                            padding: "9px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "#fff",
                            fontSize: "12px",
                            lineHeight: 1.6,
                            color: "var(--color-text)",
                            resize: "vertical",
                          }}
                        />
                        <textarea
                          value={imageRevisionText}
                          onChange={(e) => setImageRevisionText(e.target.value)}
                          disabled={isGeneratingImage}
                          rows={3}
                          placeholder="부분 수정 요청 예: 배경을 더 밝게, 인물을 더 크게"
                          style={{
                            width: "100%",
                            padding: "9px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "#fff",
                            fontSize: "12px",
                            lineHeight: 1.6,
                            color: "var(--color-text)",
                            resize: "vertical",
                          }}
                        />
                        <button
                          onClick={() => void handleGenerateLibraryImage("new")}
                          disabled={isGeneratingImage}
                          style={{
                            padding: "9px 10px",
                            borderRadius: "8px",
                            border: "none",
                            background: "var(--color-primary)",
                            color: "#fff",
                            fontSize: "12px",
                            fontWeight: "700",
                            cursor: isGeneratingImage ? "not-allowed" : "pointer",
                            opacity: isGeneratingImage ? 0.7 : 1,
                          }}
                        >
                          {isGeneratingImage ? "생성 중..." : "새 이미지 생성"}
                        </button>
                        {imageError && (
                          <div style={{ fontSize: "11px", color: "#B91C1C" }}>
                            {imageError}
                          </div>
                        )}
                        {detailActionError && (
                          <div style={{ fontSize: "11px", color: "#B91C1C" }}>
                            {detailActionError}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <DetailSection title={`❓ 독해 문제 (${effectiveDetailPackage?.reading.questions.length ?? 0}문항)`} content={(effectiveDetailPackage?.reading.questions ?? []).map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />
                  <DetailSection title={`📝 어휘 (${effectiveDetailPackage?.vocabulary.words.length ?? 0}단어)`} content={(effectiveDetailPackage?.vocabulary.words ?? []).map((w) => `• ${w.word}: ${w.definition}`).join("\n")} />
                  <DetailSection title="📐 문법 포인트" content={effectiveDetailPackage ? `${effectiveDetailPackage.grammar.focusPoint}\n\n${effectiveDetailPackage.grammar.explanation}` : ""} />
                  <DetailSection
                    title={`✍️ 쓰기 과제 (${effectiveDetailPackage ? getWritingTasks(effectiveDetailPackage.writing).length : 0}개)`}
                    content={(effectiveDetailPackage ? getWritingTasks(effectiveDetailPackage.writing) : [])
                      .map((task, index) => `쓰기 ${index + 1}\n${task.prompt}`)
                      .join("\n\n")}
                  />
                  <DetailSection title={`📊 평가지 (${effectiveDetailPackage?.assessment.totalPoints ?? 0}점)`} content={(effectiveDetailPackage?.assessment.questions ?? []).map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />

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
              {detailActionError && (
                <div style={{ fontSize: "10px", color: "#B91C1C", marginBottom: "8px", lineHeight: 1.5 }}>
                  {detailActionError}
                </div>
              )}
              {lessonDetail?.package.documentTemplate?.name && (
                <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginBottom: "8px", lineHeight: 1.5 }}>
                  현재 저장된 템플릿: {lessonDetail.package.documentTemplate.name}
                </div>
              )}
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
