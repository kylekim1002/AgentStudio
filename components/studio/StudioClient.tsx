"use client";

import { useState, useEffect, useRef } from "react";
import { AgentName, AIProvider, ContentCounts, DEFAULT_CONTENT_COUNTS } from "@/lib/agents/types";
import { LessonStatus } from "@/lib/collab/lesson";
import { useLessonGenerate } from "@/hooks/useLessonGenerate";
import { ContentCheckpoint, PassageCheckpoint } from "@/lib/workflows/lesson/types";
import { DocumentTemplate, resolveDocumentTemplate } from "@/lib/documentTemplates";
import AgentPanel from "./AgentPanel";
import ChatPanel from "./ChatPanel";
import PipelinePanel from "./PipelinePanel";
import PreviewPanel from "./PreviewPanel";
import SaveDialog from "./SaveDialog";
import { dispatchInboxSync } from "@/lib/ui/inboxSync";

type Mode = "chat" | "pipeline";
interface StudioClientProps {
  canViewPipeline: boolean;
  canSelectProvider: boolean;
  canToggleApproval: boolean;
  canExportTeacher: boolean;
  defaultProvider?: AIProvider;
  initialDocumentTemplates: DocumentTemplate[];
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

const STUDIO_TEMPLATE_STORAGE_KEY = "cyj-studio:selected-template";
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
  const [showCounts, setShowCounts] = useState(false);
  const [contentCounts, setContentCounts] = useState<Required<ContentCounts>>({ ...DEFAULT_CONTENT_COUNTS });
  const [documentTemplates] = useState<DocumentTemplate[]>(initialDocumentTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialDocumentTemplates[0]?.id ?? "");
  const [generationTarget, setGenerationTarget] = useState<"full" | "passage_review" | "content_review" | "passage_and_content_review">("full");
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewPassage, setReviewPassage] = useState("");
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [contentRevisionNotes, setContentRevisionNotes] = useState<Partial<Record<AgentName, string>>>({});
  const [lastUserInput, setLastUserInput] = useState("");
  const activeTemplate = resolveDocumentTemplate(documentTemplates, selectedTemplateId);

  const { isRunning, agentStates, lessonPackage, passageCheckpoint, contentCheckpoint, error, generate, reset } = useLessonGenerate();
  const prevPackage = useRef<typeof lessonPackage>(null);
  const prevCheckpoint = useRef<PassageCheckpoint | null>(null);
  const prevContentCheckpoint = useRef<ContentCheckpoint | null>(null);

  useEffect(() => {
    const savedTemplateId = window.localStorage.getItem(STUDIO_TEMPLATE_STORAGE_KEY);
    if (savedTemplateId && initialDocumentTemplates.some((template) => template.id === savedTemplateId)) {
      setSelectedTemplateId(savedTemplateId);
    }

    const savedGenerationTarget = window.localStorage.getItem(STUDIO_TARGET_STORAGE_KEY);
    if (
      savedGenerationTarget === "full" ||
      savedGenerationTarget === "passage_review" ||
      savedGenerationTarget === "content_review" ||
      savedGenerationTarget === "passage_and_content_review"
    ) {
      setGenerationTarget(savedGenerationTarget);
    }
  }, [initialDocumentTemplates]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    window.localStorage.setItem(STUDIO_TEMPLATE_STORAGE_KEY, selectedTemplateId);
  }, [selectedTemplateId]);

  useEffect(() => {
    window.localStorage.setItem(STUDIO_TARGET_STORAGE_KEY, generationTarget);
  }, [generationTarget]);

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
      setShowPreview(true);
    }
    prevCheckpoint.current = passageCheckpoint;
  }, [passageCheckpoint]);

  useEffect(() => {
    if (contentCheckpoint && contentCheckpoint !== prevContentCheckpoint.current) {
      setContentRevisionNotes({});
      setShowPreview(true);
    }
    prevContentCheckpoint.current = contentCheckpoint;
  }, [contentCheckpoint]);

  const activeProvider = PROVIDERS.find((p) => p.value === provider)!;

  function handleConfirmGenerate(chatSummary: string) {
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
        title: trimmedTitle,
        passage: trimmedPassage || passageCheckpoint.approvedPassageLock.passage,
        wordCount,
      },
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
      return checkpoint.writing.prompt;
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
    await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: {
          ...lessonPackage,
          title: lessonName || lessonPackage.title,
          documentTemplate: activeTemplate,
        },
        provider,
        project_id: projectId,
        tags: tagList,
        status,
        reviewer_id: reviewerId,
      }),
    });
    dispatchInboxSync("lesson_saved");
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

        {/* 문항 수 설정 */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowCounts((v) => !v)}
            disabled={isRunning}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "5px 10px", borderRadius: "6px",
              border: `1px solid ${showCounts ? "var(--color-primary)" : "var(--color-border)"}`,
              background: showCounts ? "var(--color-primary-light)" : "var(--color-surface)",
              color: showCounts ? "var(--color-primary)" : "var(--color-text-muted)",
              fontSize: "12px", fontWeight: "500",
              cursor: isRunning ? "not-allowed" : "pointer",
              opacity: isRunning ? 0.5 : 1,
              transition: ".15s",
            }}
            title="각 영역별 문항 수를 조정합니다"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2h8M2 6h8M2 10h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            문항수 {contentCounts.reading}·{contentCounts.vocabulary}·{contentCounts.assessment}·{contentCounts.grammarExercises}
          </button>

          {showCounts && (
            <>
              {/* Click-outside backdrop */}
              <div
                onClick={() => setShowCounts(false)}
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
              />
              {/* Popover */}
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0,
                minWidth: "260px", padding: "12px 14px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "9px",
                boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
                zIndex: 50,
              }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "4px", letterSpacing: ".3px", textTransform: "uppercase" }}>
                  영역별 문항 수
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginBottom: "10px", lineHeight: "1.4" }}>
                  생성 시작 전에 각 영역의 문항 수를 지정할 수 있습니다
                </div>

                {([
                  { key: "reading" as const,          label: "독해 문항",    hint: "ex. 5",  min: 1,  max: 30 },
                  { key: "vocabulary" as const,       label: "어휘 단어",    hint: "ex. 8",  min: 1,  max: 30 },
                  { key: "assessment" as const,       label: "평가 문항",    hint: "ex. 10", min: 1,  max: 30 },
                  { key: "grammarExercises" as const, label: "문법 연습",    hint: "ex. 8",  min: 2,  max: 20 },
                ]).map((row) => (
                  <div key={row.key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "5px 0" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", color: "var(--color-text)", fontWeight: "500" }}>{row.label}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>기본 {DEFAULT_CONTENT_COUNTS[row.key]}</div>
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
                        width: "58px", padding: "5px 8px",
                        borderRadius: "6px",
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

        <div style={{ position: "relative" }}>
          <select
            value={generationTarget}
            onChange={(e) => setGenerationTarget(e.target.value as "full" | "passage_review")}
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
