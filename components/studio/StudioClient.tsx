"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { AgentName, AIProvider, ContentCounts, DEFAULT_CONTENT_COUNTS } from "@/lib/agents/types";
import { LessonStatus } from "@/lib/collab/lesson";
import { useLessonGenerate } from "@/hooks/useLessonGenerate";
import { ContentCheckpoint, PassageCheckpoint, getWritingTasks } from "@/lib/workflows/lesson/types";
import {
  AUTO_DOCUMENT_TEMPLATE,
  AUTO_DOCUMENT_TEMPLATE_ID,
  DocumentTemplate,
  getTemplateSectionBlockCounts,
  getTemplateSuggestedContentCounts,
  normalizeDocumentTemplates,
  resolveDocumentTemplate,
} from "@/lib/documentTemplates";
import { DEFAULT_IMAGE_PROMPT_PRESETS, ImagePromptPreset } from "@/lib/imagePrompts";
import { getTemplateImageItems } from "@/lib/documentTemplateRender";
import AgentPanel from "./AgentPanel";
import ChatPanel from "./ChatPanel";
import PipelinePanel from "./PipelinePanel";
import PreviewPanel from "./PreviewPanel";
import SaveDialog from "./SaveDialog";
import { dispatchInboxSync } from "@/lib/ui/inboxSync";

type Mode = "chat" | "pipeline";
type GenerationTarget = "full" | "passage_review" | "content_review" | "passage_and_content_review";
interface StudioClientProps {
  canViewPipeline: boolean;
  canSelectProvider: boolean;
  canToggleApproval: boolean;
  canExportTeacher: boolean;
  defaultProvider?: AIProvider;
  initialDocumentTemplates: DocumentTemplate[];
}

interface GeneratedPassageImage {
  id: string;
  prompt: string;
  presetId?: string | null;
  url: string;
  createdAt: string;
}

const PROVIDERS: { value: AIProvider; label: string; color: string; short: string }[] = [
  { value: AIProvider.CLAUDE,  label: "Claude",  color: "#D97706", short: "C" },
  { value: AIProvider.GPT,     label: "GPT-4o",  color: "#10A37F", short: "G" },
  { value: AIProvider.GEMINI,  label: "Gemini",  color: "#4285F4", short: "Ge" },
];

const CONTENT_REVIEW_AGENTS: Array<{
  key: keyof ContentCheckpoint;
  agent: AgentName;
  title: string;
  mention: string;
}> = [
  { key: "reading", agent: AgentName.READING, title: "독해", mention: "@reading" },
  { key: "vocabulary", agent: AgentName.VOCABULARY, title: "어휘", mention: "@vocabulary" },
  { key: "grammar", agent: AgentName.GRAMMAR, title: "문법", mention: "@grammar" },
  { key: "writing", agent: AgentName.WRITING, title: "쓰기", mention: "@writing" },
  { key: "assessment", agent: AgentName.ASSESSMENT, title: "평가지", mention: "@assessment" },
];

const STUDIO_TARGET_STORAGE_KEY = "cyj-studio:generation-target";

export default function StudioClient({
  canViewPipeline,
  canSelectProvider,
  canToggleApproval,
  canExportTeacher,
  defaultProvider,
  initialDocumentTemplates,
}: StudioClientProps) {
  const [mode, setMode] = useState<Mode>("chat");
  const [provider, setProvider] = useState<AIProvider>(defaultProvider ?? AIProvider.CLAUDE);
  const [approvalMode, setApprovalMode] = useState<"auto" | "require_review">("auto");
  const [showSave, setShowSave] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showImageTools, setShowImageTools] = useState(false);
  const [showCounts, setShowCounts] = useState(false);
  const [contentCounts, setContentCounts] = useState<Required<ContentCounts>>({ ...DEFAULT_CONTENT_COUNTS });
  const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplate[]>(initialDocumentTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(AUTO_DOCUMENT_TEMPLATE_ID);
  const [generationTarget, setGenerationTarget] = useState<GenerationTarget>("full");
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewPassage, setReviewPassage] = useState("");
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [contentRevisionNotes, setContentRevisionNotes] = useState<Partial<Record<AgentName, string>>>({});
  const [lastUserInput, setLastUserInput] = useState("");
  const [imagePrompts, setImagePrompts] = useState<ImagePromptPreset[]>(DEFAULT_IMAGE_PROMPT_PRESETS);
  const [selectedImagePromptId, setSelectedImagePromptId] = useState(DEFAULT_IMAGE_PROMPT_PRESETS[0]?.id ?? "");
  const [imagePromptText, setImagePromptText] = useState(DEFAULT_IMAGE_PROMPT_PRESETS[0]?.prompt ?? "");
  const [imageRevisionText, setImageRevisionText] = useState("");
  const [generatedImages, setGeneratedImages] = useState<GeneratedPassageImage[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const activeTemplate = resolveDocumentTemplate(documentTemplates, selectedTemplateId);
  const suggestedContentCounts = useMemo(
    () => getTemplateSuggestedContentCounts(activeTemplate),
    [activeTemplate]
  );
  const templateSectionCounts = useMemo(
    () => getTemplateSectionBlockCounts(activeTemplate),
    [activeTemplate]
  );
  const templateImageItems = useMemo(() => getTemplateImageItems(activeTemplate), [activeTemplate]);
  const preferredImageTemplateItem = useMemo(
    () => templateImageItems[0]?.item ?? null,
    [templateImageItems]
  );
  const selectedImagePromptPreset = useMemo(
    () => imagePrompts.find((prompt) => prompt.id === selectedImagePromptId) ?? null,
    [imagePrompts, selectedImagePromptId]
  );

  const { isRunning, agentStates, lessonPackage, passageCheckpoint, contentCheckpoint, error, generate, reset } = useLessonGenerate();
  const imageSourceTitle = useMemo(
    () =>
      reviewTitle.trim() ||
      passageCheckpoint?.approvedPassageLock.title ||
      lessonPackage?.title ||
      "",
    [reviewTitle, passageCheckpoint, lessonPackage]
  );
  const imageSourcePassage = useMemo(
    () =>
      reviewPassage.trim() ||
      passageCheckpoint?.approvedPassageLock.passage ||
      lessonPackage?.passage ||
      "",
    [reviewPassage, passageCheckpoint, lessonPackage]
  );
  const canOpenImageTools = imageSourcePassage.trim().length > 0;
  const prevPackage = useRef<typeof lessonPackage>(null);
  const prevCheckpoint = useRef<PassageCheckpoint | null>(null);
  const prevContentCheckpoint = useRef<ContentCheckpoint | null>(null);

  useEffect(() => {
    const savedGenerationTarget = window.localStorage.getItem(STUDIO_TARGET_STORAGE_KEY);
    if (
      savedGenerationTarget === "full" ||
      savedGenerationTarget === "passage_review" ||
      savedGenerationTarget === "content_review" ||
      savedGenerationTarget === "passage_and_content_review"
    ) {
      setGenerationTarget(savedGenerationTarget);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/system-settings/document-templates", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.templates)) return;
        const nextTemplates = [
          AUTO_DOCUMENT_TEMPLATE,
          ...normalizeDocumentTemplates(data.templates).filter(
            (template) => template.id !== AUTO_DOCUMENT_TEMPLATE_ID
          ),
        ];
        setDocumentTemplates(nextTemplates);
        setSelectedTemplateId((current) =>
          nextTemplates.some((template) => template.id === current)
            ? current
            : AUTO_DOCUMENT_TEMPLATE_ID
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STUDIO_TARGET_STORAGE_KEY, generationTarget);
  }, [generationTarget]);

  useEffect(() => {
    setContentCounts(suggestedContentCounts);
  }, [
    selectedTemplateId,
    suggestedContentCounts.reading,
    suggestedContentCounts.vocabulary,
    suggestedContentCounts.assessment,
    suggestedContentCounts.grammarExercises,
    suggestedContentCounts.writing,
  ]);

  // Auto-open save dialog when a new lesson package is generated
  useEffect(() => {
    if (lessonPackage && lessonPackage !== prevPackage.current) {
      setShowSave(true);
    }
    prevPackage.current = lessonPackage;
  }, [lessonPackage]);

  useEffect(() => {
    if (passageCheckpoint && passageCheckpoint !== prevCheckpoint.current) {
      setReviewTitle(passageCheckpoint.approvedPassageLock.title);
      setReviewPassage(passageCheckpoint.approvedPassageLock.passage);
      setRevisionPrompt("");
      setGeneratedImages([]);
      setImageRevisionText("");
      setImageError(null);
      setShowPreview(true);
    }
    prevCheckpoint.current = passageCheckpoint;
  }, [passageCheckpoint]);

  function updateActiveTemplateImageBinding(itemId: string, imageIndex: number | null, imageId?: string | null) {
    setDocumentTemplates((prev) =>
      prev.map((template) => {
        if (template.id !== activeTemplate.id) return template;
        return {
          ...template,
          pages: template.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === itemId
                ? { ...item, imageBindingIndex: imageIndex, imageBindingId: imageId ?? null }
                : item
            ),
          })),
        };
      })
    );
  }

  useEffect(() => {
    fetch("/api/system-settings/image-prompts")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.prompts) || data.prompts.length === 0) return;
        setImagePrompts(data.prompts);
        setSelectedImagePromptId(data.prompts[0].id);
        setImagePromptText(data.prompts[0].prompt);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canOpenImageTools) {
      setShowImageTools(false);
    }
  }, [canOpenImageTools]);

  useEffect(() => {
    if (!showImageTools) return;

    const preferredPresetId =
      preferredImageTemplateItem?.imagePromptPresetId &&
      imagePrompts.some((prompt) => prompt.id === preferredImageTemplateItem.imagePromptPresetId)
        ? preferredImageTemplateItem.imagePromptPresetId
        : selectedImagePromptId || imagePrompts[0]?.id || "";
    const preferredPreset =
      imagePrompts.find((prompt) => prompt.id === preferredPresetId) ?? imagePrompts[0] ?? null;
    const preferredPromptText =
      preferredImageTemplateItem?.imagePromptText?.trim() ||
      preferredPreset?.prompt ||
      "";

    if (preferredPresetId && preferredPresetId !== selectedImagePromptId) {
      setSelectedImagePromptId(preferredPresetId);
    }
    if (preferredPromptText && preferredPromptText !== imagePromptText) {
      setImagePromptText(preferredPromptText);
    }
  }, [
    showImageTools,
    preferredImageTemplateItem,
    imagePrompts,
    selectedImagePromptId,
    imagePromptText,
  ]);

  useEffect(() => {
    if (contentCheckpoint && contentCheckpoint !== prevContentCheckpoint.current) {
      setContentRevisionNotes({});
      setShowPreview(true);
    }
    prevContentCheckpoint.current = contentCheckpoint;
  }, [contentCheckpoint]);

  const activeProvider = PROVIDERS.find((p) => p.value === provider)!;

  function handleConfirmGenerate(chatSummary: string) {
    setGeneratedImages([]);
    setImageRevisionText("");
    setImageError(null);
    setLastUserInput(chatSummary || "전체 파이프라인을 실행해 주세요.");
    generate({
      userInput: chatSummary || "전체 파이프라인을 실행해 주세요.",
      provider,
      approvalMode,
      contentCounts,
      generationTarget,
    });
  }

  function handleRunAll(userInput?: string) {
    const nextInput = userInput || "전체 파이프라인을 실행해 주세요.";
    setGeneratedImages([]);
    setImageRevisionText("");
    setImageError(null);
    setLastUserInput(nextInput);
    generate({
      userInput: nextInput,
      provider,
      approvalMode,
      contentCounts,
      generationTarget,
    });
  }

  function buildEditedCheckpoint() {
    if (!passageCheckpoint) return null;
    const trimmedPassage = reviewPassage.trim();
    const trimmedTitle = reviewTitle.trim() || passageCheckpoint.approvedPassageLock.title;
    const normalizedPassage = trimmedPassage || passageCheckpoint.approvedPassageLock.passage;
    const normalizedTitle = trimmedTitle || passageCheckpoint.approvedPassageLock.title;
    const needsRevalidation =
      normalizedPassage !== passageCheckpoint.approvedPassageLock.passage ||
      normalizedTitle !== passageCheckpoint.approvedPassageLock.title;
    const wordCount = trimmedPassage
      ? trimmedPassage
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean).length
      : passageCheckpoint.approvedPassageLock.wordCount;

    return {
      ...passageCheckpoint,
      approvedPassageLock: {
        ...passageCheckpoint.approvedPassageLock,
        title: normalizedTitle,
        passage: normalizedPassage,
        wordCount,
      },
      needsRevalidation,
    };
  }

  function handleContinueFromPassage() {
    const checkpoint = buildEditedCheckpoint();
    if (!checkpoint) return;
    generate({
      userInput: lastUserInput || "전체 파이프라인을 실행해 주세요.",
      provider,
      approvalMode,
      contentCounts,
      generationTarget:
        generationTarget === "passage_and_content_review"
          ? "content_review"
          : "full",
      passageCheckpoint: checkpoint,
    });
  }

  function handleRegeneratePassage(fullReset: boolean) {
    const baseInput = lastUserInput || "전체 파이프라인을 실행해 주세요.";
    const revisionText = revisionPrompt.trim();
    const nextInput =
      !fullReset && revisionText
        ? `${baseInput}\n\n지문 수정 요청:\n${revisionText}`
        : baseInput;

    setLastUserInput(nextInput);
    if (fullReset) {
      setGeneratedImages([]);
      setImageRevisionText("");
      setImageError(null);
    }
    generate({
      userInput: nextInput,
      provider,
      approvalMode,
      contentCounts,
      generationTarget:
        generationTarget === "passage_and_content_review"
          ? "passage_and_content_review"
          : "passage_review",
    });
  }

  function handleContinueFromContent() {
    if (!contentCheckpoint) return;
    generate({
      userInput: lastUserInput || "전체 파이프라인을 실행해 주세요.",
      provider,
      approvalMode,
      contentCounts,
      generationTarget: "full",
      contentCheckpoint,
    });
  }

  function handleRegenerateContentAgent(agent: AgentName) {
    if (!contentCheckpoint) return;
    generate({
      userInput: lastUserInput || "전체 파이프라인을 실행해 주세요.",
      provider,
      approvalMode,
      contentCounts,
      generationTarget: "content_review",
      contentCheckpoint,
      regenerateAgents: [agent],
      revisionInstructions: contentRevisionNotes,
    });
  }

  function handleRegenerateAllContent() {
    if (!contentCheckpoint) return;
    generate({
      userInput: lastUserInput || "전체 파이프라인을 실행해 주세요.",
      provider,
      approvalMode,
      contentCounts,
      generationTarget: "content_review",
      passageCheckpoint: {
        approvedPassageLock: contentCheckpoint.approvedPassageLock,
        difficultyLock: contentCheckpoint.difficultyLock,
        teachingFrame: contentCheckpoint.teachingFrame,
      },
    });
  }

  function handleSelectImagePrompt(presetId: string) {
    setSelectedImagePromptId(presetId);
    const preset = imagePrompts.find((item) => item.id === presetId);
    if (preset) {
      setImagePromptText(preset.prompt);
    }
  }

  function summarizeContentSection(checkpoint: ContentCheckpoint, key: keyof ContentCheckpoint) {
    if (key === "reading") {
      return checkpoint.reading.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n");
    }
    if (key === "vocabulary") {
      return checkpoint.vocabulary.words.map((w) => `${w.word} — ${w.definition}`).join("\n");
    }
    if (key === "grammar") {
      return `${checkpoint.grammar.focusPoint}\n\n${checkpoint.grammar.explanation}`;
    }
    if (key === "writing") {
      return getWritingTasks(checkpoint.writing)
        .map((task, index) => `쓰기 ${index + 1}. ${task.prompt}`)
        .join("\n");
    }
    if (key === "assessment") {
      return checkpoint.assessment.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n");
    }
    return "";
  }

  async function handleSave(
    projectId: string | null,
    lessonName: string,
    tags: string,
    status: LessonStatus,
    reviewerId: string | null
  ) {
    if (!lessonPackage) return;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const response = await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: {
          ...lessonPackage,
          title: lessonName || lessonPackage.title,
          documentTemplate: activeTemplate,
          generatedImages,
        },
        provider,
        project_id: projectId,
        tags: tagList,
        status,
        reviewer_id: reviewerId,
      }),
    });
    if (!response.ok) {
      let message = "레슨 저장 중 오류가 발생했습니다.";
      try {
        const data = await response.json();
        if (typeof data?.error === "string" && data.error.trim()) {
          message = data.error;
        }
      } catch {}
      throw new Error(message);
    }
    dispatchInboxSync("lesson_saved");
  }

  async function handleGeneratePassageImage(mode: "new" | "revise", imageId?: string) {
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
          title: imageSourceTitle,
          passage: imageSourcePassage,
          prompt,
          revision: mode === "revise" ? imageRevisionText : undefined,
          presetId: selectedImagePromptId || null,
          references: selectedImagePromptPreset?.references ?? [],
          previousImageId: imageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "이미지 생성 실패");
      }
      const nextImage = data.image as GeneratedPassageImage;
      setGeneratedImages((prev) => {
        if (mode === "revise" && imageId) {
          return [nextImage, ...prev.filter((image) => image.id !== imageId)];
        }
        return [nextImage, ...prev];
      });
      setImageRevisionText("");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "이미지 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGeneratingImage(false);
    }
  }

  // Convert Map<AgentName, AgentProgressState> → Map<AgentName, AgentStatus>
  const statusMap = new Map(
    Array.from(agentStates.entries()).map(([k, v]) => [k, v.status])
  );
  const outputMap = new Map(
    Array.from(agentStates.entries()).map(([k, v]) => [k, v.output])
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        height: "44px", flexShrink: 0,
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center",
        padding: "0 16px", gap: "8px",
      }}>

        {/* Mode toggle */}
        <div style={{
          display: "flex", alignItems: "center", gap: "2px",
          background: "var(--color-bg)", border: "1px solid var(--color-border)",
          borderRadius: "7px", padding: "3px",
        }}>
          {(["chat", "pipeline"] as Mode[]).map((m) => (
            (!canViewPipeline && m === "pipeline") ? null : (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                padding: "5px 12px", borderRadius: "5px",
                fontSize: "12px", fontWeight: mode === m ? "600" : "500",
                color: mode === m ? "var(--color-primary)" : "var(--color-text-muted)",
                background: mode === m ? "var(--color-surface)" : "none",
                boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,.08)" : "none",
                border: "none", cursor: "pointer", transition: ".15s",
              }}
            >
              {m === "chat" ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1h10v7H7L4 11V8H1V1z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/></svg>
                  채팅 모드
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="2" cy="6" r="1.4" fill="currentColor"/><circle cx="6" cy="6" r="1.4" fill="currentColor"/><circle cx="10" cy="6" r="1.4" fill="currentColor"/><path d="M3.4 6h1.2M7.4 6h1.2" stroke="currentColor" strokeWidth="1.2"/></svg>
                  파이프라인 모드
                </>
              )}
            </button>
            )
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: "1px", height: "20px", background: "var(--color-border)", margin: "0 4px" }} />

        {/* Provider selector */}
        {canSelectProvider && (
        <div style={{ position: "relative" }}>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as AIProvider)}
            style={{
              appearance: "none",
              paddingLeft: "28px", paddingRight: "22px", paddingTop: "5px", paddingBottom: "5px",
              borderRadius: "6px", border: "1px solid var(--color-border)",
              fontSize: "12px", color: "var(--color-text-muted)",
              background: "var(--color-surface)", outline: "none", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {/* Provider icon */}
          <div style={{
            position: "absolute", left: "7px", top: "50%", transform: "translateY(-50%)",
            width: "15px", height: "15px", borderRadius: "3px",
            background: activeProvider.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "8px", fontWeight: "700", color: "#fff", pointerEvents: "none",
          }}>
            {activeProvider.short}
          </div>
          {/* Chevron */}
          <div style={{ position: "absolute", right: "7px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 3l2.5 3L7 3" stroke="var(--color-text-muted)" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
        </div>
        )}

        {canToggleApproval && (
          <>
            <div style={{ width: "1px", height: "20px", background: "var(--color-border)", margin: "0 4px" }} />

        <button
          onClick={() =>
            setApprovalMode((prev) =>
              prev === "auto" ? "require_review" : "auto"
            )
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "5px 10px",
            borderRadius: "6px",
            border: `1px solid ${
              approvalMode === "require_review"
                ? "var(--color-primary)"
                : "var(--color-border)"
            }`,
            background:
              approvalMode === "require_review"
                ? "var(--color-primary-light)"
                : "var(--color-surface)",
            color:
              approvalMode === "require_review"
                ? "var(--color-primary)"
                : "var(--color-text-muted)",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            transition: ".15s",
          }}
          title="최종 발행 전에 관리자 승인을 받도록 설정합니다."
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1l4 1.5v3c0 2.6-1.7 4.7-4 5.5-2.3-.8-4-2.9-4-5.5v-3L6 1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M4.2 6.1l1.1 1.1 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {approvalMode === "require_review" ? "발행 승인 ON" : "발행 승인 OFF"}
        </button>
          </>
        )}

        <div style={{ position: "relative" }}>
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            disabled={isRunning}
            style={{
              appearance: "none",
              paddingLeft: "10px", paddingRight: "22px", paddingTop: "5px", paddingBottom: "5px",
              borderRadius: "6px", border: "1px solid var(--color-border)",
              fontSize: "12px", color: "var(--color-text-muted)",
              background: "var(--color-surface)", outline: "none", fontFamily: "inherit",
              cursor: isRunning ? "not-allowed" : "pointer",
              opacity: isRunning ? 0.6 : 1,
              maxWidth: "180px",
            }}
            title="문서 템플릿을 선택합니다"
          >
            {documentTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <div style={{ position: "absolute", right: "7px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 3l2.5 3L7 3" stroke="var(--color-text-muted)" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
        </div>

        {/* 문항 수 설정 */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 360px", justifyContent: "flex-end" }}>
          <button
            onClick={() => setShowCounts((v) => !v)}
            disabled={isRunning}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "5px 10px", borderRadius: "8px",
              border: `1px solid ${showCounts ? "var(--color-primary)" : "var(--color-border)"}`,
              background: showCounts ? "var(--color-primary-light)" : "var(--color-surface)",
              color: showCounts ? "var(--color-primary)" : "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "600",
              cursor: isRunning ? "not-allowed" : "pointer",
              opacity: isRunning ? 0.5 : 1,
              transition: ".15s",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
            title="각 영역별 문항 수를 조정합니다"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2h8M2 6h8M2 10h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            문항 수 설정
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "6px", minWidth: 0 }}>
            {[
              { label: "독해", value: contentCounts.reading },
              { label: "어휘", value: contentCounts.vocabulary },
              { label: "평가", value: contentCounts.assessment },
              { label: "문법", value: contentCounts.grammarExercises },
              { label: "쓰기", value: contentCounts.writing },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: "4px 9px",
                  borderRadius: "999px",
                  border: "1px solid var(--color-border)",
                  background: showCounts ? "rgba(59,130,246,0.08)" : "var(--color-surface)",
                  fontSize: "11px",
                  color: showCounts ? "var(--color-primary)" : "var(--color-text-muted)",
                  fontWeight: "700",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label} {item.value}
              </div>
            ))}
          </div>

          {showCounts && (
            <>
              <div
                onClick={() => setShowCounts(false)}
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
              />
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                minWidth: "300px", padding: "14px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
                zIndex: 50,
              }}>
                <div style={{ fontSize: "12px", fontWeight: "800", color: "var(--color-text)", marginBottom: "4px" }}>
                  영역별 문항 수
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginBottom: "10px", lineHeight: "1.5" }}>
                  템플릿을 먼저 고르고, 그 기준에 맞춰 필요한 영역만 미세 조정하는 방식이 가장 안정적입니다.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "6px",
                    marginBottom: "12px",
                  }}
                >
                  {[
                    { label: "지문", value: templateSectionCounts.passage },
                    { label: "독해", value: templateSectionCounts.reading },
                    { label: "어휘", value: templateSectionCounts.vocabulary },
                    { label: "문법", value: templateSectionCounts.grammar },
                    { label: "쓰기", value: templateSectionCounts.writing },
                    { label: "평가", value: templateSectionCounts.assessment },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg)",
                        display: "grid",
                        gap: "2px",
                      }}
                    >
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>{item.label}</div>
                      <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--color-text)" }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {([
                  { key: "reading" as const, label: "독해 문항", min: 1, max: 30, templateValue: suggestedContentCounts.reading },
                  { key: "vocabulary" as const, label: "어휘 단어", min: 1, max: 30, templateValue: suggestedContentCounts.vocabulary },
                  { key: "assessment" as const, label: "평가 문항", min: 1, max: 30, templateValue: suggestedContentCounts.assessment },
                  { key: "grammarExercises" as const, label: "문법 문제", min: 1, max: 20, templateValue: suggestedContentCounts.grammarExercises },
                  { key: "writing" as const, label: "쓰기 과제", min: 1, max: 10, templateValue: suggestedContentCounts.writing },
                ]).map((row) => (
                  <div key={row.key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", color: "var(--color-text)", fontWeight: "600" }}>{row.label}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>
                        기본 {DEFAULT_CONTENT_COUNTS[row.key]} · 템플릿 {row.templateValue}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={row.min}
                      max={row.max}
                      value={contentCounts[row.key]}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        if (!Number.isFinite(raw)) return;
                        const clamped = Math.min(Math.max(Math.floor(raw), row.min), row.max);
                        setContentCounts((prev) => ({ ...prev, [row.key]: clamped }));
                      }}
                      style={{
                        width: "62px", padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-strong)",
                        fontSize: "12px", textAlign: "center",
                        color: "var(--color-text)",
                        background: "var(--color-bg)",
                        outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                ))}

                <div style={{ display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--color-border)" }}>
                  <button
                    onClick={() => setContentCounts({ ...DEFAULT_CONTENT_COUNTS })}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: "6px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text-muted)",
                      fontSize: "11px", fontWeight: "500", cursor: "pointer",
                    }}
                  >
                    기본값
                  </button>
                  <button
                    onClick={() => setShowCounts(false)}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: "6px",
                      border: "none",
                      background: "var(--color-primary)", color: "#fff",
                      fontSize: "11px", fontWeight: "600", cursor: "pointer",
                    }}
                  >
                    확인
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <select
            value={generationTarget}
            onChange={(e) => setGenerationTarget(e.target.value as GenerationTarget)}
            disabled={isRunning}
            style={{
              appearance: "none",
              paddingLeft: "10px", paddingRight: "22px", paddingTop: "5px", paddingBottom: "5px",
              borderRadius: "6px", border: "1px solid var(--color-border)",
              fontSize: "12px", color: "var(--color-text-muted)",
              background: "var(--color-surface)", outline: "none", fontFamily: "inherit",
              cursor: isRunning ? "not-allowed" : "pointer",
              opacity: isRunning ? 0.6 : 1,
            }}
            title="생성 범위를 선택합니다"
          >
            <option value="full">01~16 전체 생성</option>
            <option value="passage_review">09 지문 확정까지 생성 후 검토</option>
            <option value="content_review">14 콘텐츠 생성까지 완료 후 검토</option>
            <option value="passage_and_content_review">지문 검토 후 콘텐츠도 검토</option>
          </select>
          <div style={{ position: "absolute", right: "7px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 3l2.5 3L7 3" stroke="var(--color-text-muted)" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
        </div>

        {/* Toolbar right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "7px" }}>
          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "5px 10px", borderRadius: "6px",
              border: `1px solid ${showPreview ? "var(--color-primary)" : "var(--color-border)"}`,
              background: showPreview ? "var(--color-primary-light)" : "var(--color-surface)",
              color: showPreview ? "var(--color-primary)" : "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "500", cursor: "pointer", transition: ".15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 2h8l2 2v6H1V2z" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M3 5h6M3 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
            미리보기
          </button>

          <button
            onClick={() => {
              if (!canOpenImageTools) return;
              setShowImageTools((v) => !v);
            }}
            disabled={!canOpenImageTools}
            title={
              canOpenImageTools
                ? "현재 지문을 기준으로 이미지 생성/수정 패널을 엽니다."
                : "지문이 준비되면 이미지 생성 패널을 열 수 있습니다."
            }
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "5px 10px", borderRadius: "6px",
              border: `1px solid ${
                !canOpenImageTools
                  ? "var(--color-border)"
                  : showImageTools
                    ? "#EA580C"
                    : "var(--color-border)"
              }`,
              background: !canOpenImageTools
                ? "var(--color-bg)"
                : showImageTools
                  ? "#FFF7ED"
                  : "var(--color-surface)",
              color: !canOpenImageTools
                ? "var(--color-text-subtle)"
                : showImageTools
                  ? "#C2410C"
                  : "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "500",
              cursor: !canOpenImageTools ? "not-allowed" : "pointer",
              transition: ".15s",
              opacity: !canOpenImageTools ? 0.65 : 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 9.5l1.3-3.2L6.5 3l2.5-1 1 2.5L9 7.5 5.7 10.7 2.5 12 2 9.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
              <path d="M7.2 2.3l2.5 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            </svg>
            이미지
          </button>

          {/* Save */}
          <button
            onClick={() => setShowSave(true)}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "5px 12px", borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)", color: "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "500", cursor: "pointer", transition: ".15s",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-strong)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text)";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1h7.5L11 3.5V11H1V1zM3 1v3h5V1M3 11V7h6v4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg>
            저장
          </button>

          {/* Export */}
          <button
            disabled={!lessonPackage}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "5px 12px", borderRadius: "6px",
              background: lessonPackage ? "var(--color-primary)" : "var(--color-border-strong)",
              color: lessonPackage ? "#fff" : "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "600",
              border: "none", cursor: lessonPackage ? "pointer" : "not-allowed", transition: ".15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            내보내기
          </button>
        </div>
      </div>

      {/* ── Body (3 panels) ── */}
      {passageCheckpoint && (
        <div style={{
          background: "#FFFBEB",
          borderBottom: "1px solid #FDE68A",
          padding: "14px 16px",
          display: "grid",
          gridTemplateColumns: showPreview ? "minmax(0, 1.2fr) minmax(280px, 0.8fr)" : "1fr",
          gap: "14px",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#92400E", marginBottom: "6px" }}>
              지문 1차 검토 단계
            </div>
            <div style={{ fontSize: "12px", color: "#A16207", lineHeight: 1.6, marginBottom: "10px" }}>
              09 지문 확정 잠금기까지 생성했습니다. 제목과 지문을 검토한 뒤 그대로 다음 단계로 진행하거나, 수정 요청을 반영해 지문만 다시 생성할 수 있습니다.
            </div>
            <input
              value={reviewTitle}
              onChange={(e) => setReviewTitle(e.target.value)}
              disabled={isRunning}
              style={{
                width: "100%",
                marginBottom: "8px",
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid #FCD34D",
                background: "#fff",
                fontSize: "13px",
                color: "var(--color-text)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <textarea
              value={reviewPassage}
              onChange={(e) => setReviewPassage(e.target.value)}
              disabled={isRunning}
              rows={8}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #FCD34D",
                background: "#fff",
                fontSize: "12px",
                lineHeight: 1.7,
                color: "var(--color-text)",
                outline: "none",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </div>
          <div style={{
            background: "rgba(255,255,255,0.75)",
            border: "1px solid #FDE68A",
            borderRadius: "10px",
            padding: "12px",
            minWidth: 0,
          }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#92400E", marginBottom: "6px" }}>
              다음 액션
            </div>
            <div style={{ fontSize: "11px", color: "#A16207", lineHeight: 1.6, marginBottom: "10px" }}>
              수정 방향이 있다면 아래에 적고 지문만 다시 생성하세요. 그대로 괜찮으면 다음 단계로 이어서 10~16을 생성합니다.
            </div>
            <textarea
              value={revisionPrompt}
              onChange={(e) => setRevisionPrompt(e.target.value)}
              disabled={isRunning}
              placeholder="예: 도입 문장을 더 자연스럽게, 문단 2는 초등부 어휘로 낮춰줘"
              rows={5}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "#fff",
                fontSize: "12px",
                lineHeight: 1.6,
                color: "var(--color-text)",
                outline: "none",
                boxSizing: "border-box",
                resize: "vertical",
                marginBottom: "10px",
              }}
            />
            <div style={{ display: "grid", gap: "8px" }}>
              <button
                type="button"
                onClick={handleContinueFromPassage}
                disabled={isRunning}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--color-primary)",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: isRunning ? "not-allowed" : "pointer",
                  opacity: isRunning ? 0.7 : 1,
                }}
              >
                이 지문으로 다음 단계 진행
              </button>
              <button
                type="button"
                onClick={() => handleRegeneratePassage(false)}
                disabled={isRunning}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: isRunning ? "not-allowed" : "pointer",
                  opacity: isRunning ? 0.7 : 1,
                }}
              >
                수정 요청 반영해 지문 다시 생성
              </button>
              <button
                type="button"
                onClick={() => handleRegeneratePassage(true)}
                disabled={isRunning}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid #FCA5A5",
                  background: "#FEF2F2",
                  color: "#B91C1C",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: isRunning ? "not-allowed" : "pointer",
                  opacity: isRunning ? 0.7 : 1,
                }}
              >
                처음부터 완전 다시 생성
              </button>
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6, marginTop: "10px" }}>
              세부 논의가 필요하면 채팅 모드에서 <strong>@passage_generation</strong> 또는 <strong>@passage_validation</strong>를 호출해 수정 방향을 먼저 정리할 수 있습니다.
            </div>
          </div>
        </div>
      )}

      {contentCheckpoint && (
        <div style={{
          background: "#EFF6FF",
          borderBottom: "1px solid #BFDBFE",
          padding: "14px 16px",
          display: "grid",
          gap: "12px",
        }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#1D4ED8", marginBottom: "6px" }}>
              콘텐츠 2차 검토 단계
            </div>
            <div style={{ fontSize: "12px", color: "#1E40AF", lineHeight: 1.6 }}>
              독해, 어휘, 문법, 쓰기, 평가지가 생성되었습니다. 각 섹션별로 수정 지시를 남기고 부분 재생성하거나, 그대로 QA/발행 단계로 진행할 수 있습니다.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
            {CONTENT_REVIEW_AGENTS.map((section) => (
              <div
                key={section.agent}
                style={{
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid #BFDBFE",
                  borderRadius: "10px",
                  padding: "12px",
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#1D4ED8" }}>
                    {section.title}
                  </div>
                  <div style={{ fontSize: "10px", color: "#1E40AF", background: "#DBEAFE", padding: "3px 7px", borderRadius: "999px" }}>
                    {section.mention}
                  </div>
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: "11px",
                  lineHeight: 1.6,
                  color: "var(--color-text)",
                  background: "#fff",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  padding: "10px",
                  maxHeight: "180px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {summarizeContentSection(contentCheckpoint, section.key)}
                </pre>
                <textarea
                  value={contentRevisionNotes[section.agent] ?? ""}
                  onChange={(e) =>
                    setContentRevisionNotes((prev) => ({
                      ...prev,
                      [section.agent]: e.target.value,
                    }))
                  }
                  disabled={isRunning}
                  placeholder={`${section.mention} 에게 수정 방향을 지시하세요`}
                  rows={4}
                  style={{
                    width: "100%",
                    marginTop: "8px",
                    padding: "9px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "#fff",
                    fontSize: "12px",
                    lineHeight: 1.6,
                    color: "var(--color-text)",
                    outline: "none",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleRegenerateContentAgent(section.agent)}
                  disabled={isRunning}
                  style={{
                    width: "100%",
                    marginTop: "8px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid #93C5FD",
                    background: "#DBEAFE",
                    color: "#1D4ED8",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: isRunning ? "not-allowed" : "pointer",
                    opacity: isRunning ? 0.7 : 1,
                  }}
                >
                  {section.title}만 다시 생성
                </button>
              </div>
            ))}
          </div>

          <div style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
          }}>
            <button
              type="button"
              onClick={handleRegenerateAllContent}
              disabled={isRunning}
              style={{
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "600",
                cursor: isRunning ? "not-allowed" : "pointer",
                opacity: isRunning ? 0.7 : 1,
              }}
            >
              콘텐츠 전체 다시 생성
            </button>
            <button
              type="button"
              onClick={handleContinueFromContent}
              disabled={isRunning}
              style={{
                padding: "9px 12px",
                borderRadius: "8px",
                border: "none",
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "700",
                cursor: isRunning ? "not-allowed" : "pointer",
                opacity: isRunning ? 0.7 : 1,
              }}
            >
              이 상태로 QA/발행 진행
            </button>
          </div>
        </div>
      )}

      {showImageTools && (
        <div
          style={{
            background: "#FFF7ED",
            borderBottom: "1px solid #FDBA74",
            padding: "14px 16px",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#C2410C", marginBottom: "4px" }}>
                본문 기반 이미지 생성
              </div>
              <div style={{ fontSize: "11px", color: "#9A3412", lineHeight: 1.6 }}>
                현재 지문을 기준으로 언제든 이미지를 생성하거나, 기존 이미지에 부분 수정 지시를 붙여 다시 만들 수 있습니다.
              </div>
              <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                이미지 생성은 지문이 준비된 뒤에만 활성화됩니다. 생성된 이미지는 템플릿 이미지 블록과 연결해서 저장할 수 있습니다.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                기준 지문: <strong style={{ color: "var(--color-text)" }}>{imageSourceTitle || "제목 없음"}</strong>
              </div>
              <button
                type="button"
                onClick={() => setShowImageTools(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => handleGeneratePassageImage("new")}
                disabled={isGeneratingImage}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#EA580C",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: isGeneratingImage ? "not-allowed" : "pointer",
                  opacity: isGeneratingImage ? 0.7 : 1,
                  flexShrink: 0,
                }}
              >
                {isGeneratingImage ? "생성 중..." : "이미지 생성"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "10px", marginBottom: "10px" }}>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#9A3412" }}>
                프롬프트 프리셋
              </span>
              <select
                value={selectedImagePromptId}
                onChange={(e) => handleSelectImagePrompt(e.target.value)}
                disabled={isGeneratingImage}
                style={{
                  width: "100%",
                  padding: "9px 10px",
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
              <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                선택하면 오른쪽 입력창에 해당 프롬프트가 채워지고, 필요하면 바로 수정할 수 있습니다.
              </div>
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#9A3412" }}>
                현재 이미지 생성 프롬프트
              </span>
              <textarea
                value={imagePromptText}
                onChange={(e) => setImagePromptText(e.target.value)}
                disabled={isGeneratingImage}
                placeholder="이미지 생성 기본 프롬프트"
                rows={4}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "#fff",
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: "var(--color-text)",
                  outline: "none",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
              <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                현재 템플릿 이미지 블록에 기본 프롬프트가 지정돼 있으면 우선 불러오고, 없으면 선택한 프리셋으로 채웁니다.
              </div>
            </label>
          </div>

          {selectedImagePromptPreset?.references?.length ? (
            <div
              style={{
                display: "grid",
                gap: "10px",
                padding: "12px",
                borderRadius: "12px",
                border: "1px solid #FED7AA",
                background: "rgba(255,255,255,0.75)",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#9A3412", marginBottom: "4px" }}>
                  참조 이미지
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                  선택한 프리셋에 연결된 참조 이미지입니다. 실제 생성 시 함께 전달되어 구도, 질감, 분위기를 참고합니다.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                {selectedImagePromptPreset.references.map((reference, index) => (
                  <div
                    key={reference.id}
                    style={{
                      borderRadius: "10px",
                      border: "1px solid var(--color-border)",
                      background: "#fff",
                      padding: "10px",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>
                      {reference.name || `참조 이미지 ${index + 1}`}
                    </div>
                    <img
                      src={reference.url}
                      alt={reference.name || `참조 이미지 ${index + 1}`}
                      style={{
                        width: "100%",
                        aspectRatio: "4 / 3",
                        objectFit: "cover",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "#F8FAFC",
                      }}
                    />
                    {reference.notes && (
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                        {reference.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <textarea
            value={imageRevisionText}
            onChange={(e) => setImageRevisionText(e.target.value)}
            disabled={isGeneratingImage}
            placeholder="부분 수정 요청 예: 배경은 더 밝게, 인물은 더 크게, 분위기는 차분하게"
            rows={3}
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "#fff",
              fontSize: "12px",
              lineHeight: 1.6,
              color: "var(--color-text)",
              outline: "none",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />

          {imageError && (
            <div style={{ marginTop: "8px", fontSize: "11px", color: "#B91C1C" }}>
              {imageError}
            </div>
          )}

          {generatedImages.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "12px" }}>
                {generatedImages.map((image, index) => (
                  <div
                    key={image.id}
                    style={{
                      borderRadius: "10px",
                      border: "1px solid #FDBA74",
                      background: "#fff",
                      padding: "10px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#C2410C", marginBottom: "8px" }}>
                      생성 이미지 {index + 1}
                    </div>
                    <img
                      src={image.url}
                      alt="Generated passage visual"
                      style={{
                        width: "100%",
                        aspectRatio: "4 / 3",
                        objectFit: "cover",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "#F8FAFC",
                      }}
                    />
                    <div style={{ marginTop: "8px", fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                      {image.prompt}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "8px" }}>
                      <button
                        type="button"
                        onClick={() => handleGeneratePassageImage("revise", image.id)}
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
                        type="button"
                        onClick={() => handleGeneratePassageImage("new")}
                        disabled={isGeneratingImage}
                        style={{
                          padding: "7px 8px",
                          borderRadius: "7px",
                          border: "1px solid #FDBA74",
                          background: "#FFF7ED",
                          color: "#C2410C",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: isGeneratingImage ? "not-allowed" : "pointer",
                          opacity: isGeneratingImage ? 0.6 : 1,
                        }}
                      >
                        새로 생성
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {templateImageItems.length > 0 && (
                <div
                  style={{
                    marginTop: "14px",
                    padding: "12px",
                    borderRadius: "12px",
                    border: "1px solid #DBEAFE",
                    background: "#F8FBFF",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "#1D4ED8", marginBottom: "4px" }}>
                      연결할 생성 이미지
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                      생성된 이미지를 실제 템플릿의 각 이미지 블록에 연결할 수 있습니다.
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                      이 연결은 현재 생성 중인 레슨의 템플릿 스냅샷에만 적용됩니다. 저장하면 함께 보존되지만, 공용 템플릿 원본 자체가 바뀌는 것은 아닙니다.
                    </div>
                  </div>

                  {templateImageItems.map(({ pageId, item }, blockIndex) => {
                    const boundIndex = item.imageBindingIndex ?? null;
                    const boundImage =
                      item.imageBindingId
                        ? generatedImages.find((image) => image.id === item.imageBindingId) ?? null
                        : boundIndex !== null && generatedImages[boundIndex]
                          ? generatedImages[boundIndex]
                          : null;
                    return (
                      <div
                        key={item.id}
                        style={{
                          border: "1px solid var(--color-border)",
                          borderRadius: "10px",
                          background: "#fff",
                          padding: "10px",
                          display: "grid",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>
                              {item.label}
                            </div>
                            <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "2px" }}>
                              {pageId} · 이미지 블록 {blockIndex + 1}
                            </div>
                          </div>
                          <div style={{ fontSize: "10px", color: boundImage ? "#1D4ED8" : "var(--color-text-subtle)", fontWeight: "700" }}>
                            {boundImage
                              ? `현재 연결: 생성 이미지 ${generatedImages.findIndex((image) => image.id === boundImage.id) + 1}`
                              : "현재 연결: 자동"}
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => updateActiveTemplateImageBinding(item.id, null, null)}
                            style={{
                              padding: "10px",
                              borderRadius: "10px",
                              border: `1px solid ${!boundImage ? "#93C5FD" : "var(--color-border)"}`,
                              background: !boundImage ? "#EFF6FF" : "var(--color-surface)",
                              color: !boundImage ? "#1D4ED8" : "var(--color-text)",
                              fontSize: "11px",
                              fontWeight: "700",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            자동 연결
                            <div style={{ marginTop: "4px", fontSize: "10px", fontWeight: "500", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                              템플릿 안의 이미지 블록 순서대로 자동 연결합니다.
                            </div>
                          </button>
                          {generatedImages.map((image, imageIndex) => {
                            const active = boundImage?.id === image.id;
                            return (
                              <button
                                key={`${item.id}-${image.id}`}
                                type="button"
                                onClick={() => updateActiveTemplateImageBinding(item.id, imageIndex, image.id)}
                                style={{
                                  padding: "8px",
                                  borderRadius: "10px",
                                  border: `1px solid ${active ? "#93C5FD" : "var(--color-border)"}`,
                                  background: active ? "#EFF6FF" : "#fff",
                                  textAlign: "left",
                                  cursor: "pointer",
                                }}
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
                                <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
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
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Agent panel */}
        <AgentPanel
          agentStates={statusMap}
          onRunAll={handleRunAll}
          isRunning={isRunning}
        />

        {/* Center: Chat or Pipeline */}
        {mode === "chat" ? (
          <ChatPanel
            agentStates={statusMap}
            isRunning={isRunning}
            lessonPackage={lessonPackage}
            error={error}
            onConfirmGenerate={handleConfirmGenerate}
            onReset={reset}
            approvalMode={approvalMode}
          />
        ) : (
          <PipelinePanel
            agentStates={statusMap}
            agentOutputs={outputMap}
            onRunAll={(input) => handleRunAll(input)}
            isRunning={isRunning}
          />
        )}

        {/* Right: Preview panel */}
        {showPreview && (
          <PreviewPanel
            lessonPackage={lessonPackage}
            onClose={() => setShowPreview(false)}
            onSave={() => setShowSave(true)}
            canExportTeacher={canExportTeacher}
            templates={documentTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={setSelectedTemplateId}
          />
        )}
      </div>

      {/* Save dialog */}
      {showSave && (
        <SaveDialog
          lessonPackage={lessonPackage}
          selectedTemplateName={activeTemplate.name}
          onClose={() => setShowSave(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
