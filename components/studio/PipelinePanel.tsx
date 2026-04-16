"use client";

import { useEffect, useState } from "react";
import { AgentName, AgentStatus } from "@/lib/agents/types";
import { AGENT_META, PIPELINE_ORDER } from "@/lib/agentMeta";
import { normalizeCodeValues, getCodeValueItems } from "@/lib/codeValues";

interface PipelinePanelProps {
  agentStates: Map<AgentName, AgentStatus>;
  agentOutputs: Map<AgentName, unknown>;
  onRunAll: (userInput: string) => void;
  isRunning: boolean;
}

interface StoredThread {
  id: string;
  title: string;
  provider: string | null;
  created_at: string;
  updated_at: string;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

const STUDIO_THREAD_STORAGE_KEY = "cyj-studio:selected-thread-id";

const PARALLEL = new Set([
  AgentName.READING, AgentName.VOCABULARY, AgentName.GRAMMAR,
  AgentName.WRITING, AgentName.ASSESSMENT,
]);

const NODE_STYLE: Record<AgentStatus, { border: string; bg: string; color: string }> = {
  pending:  { border: "var(--color-border)",  bg: "var(--color-surface)", color: "var(--color-text-subtle)" },
  running:  { border: "#3B82F6", bg: "#EFF6FF", color: "#2563EB" },
  done:     { border: "#10B981", bg: "#ECFDF5", color: "#059669" },
  skipped:  { border: "#E2E8F0", bg: "#F8FAFC", color: "var(--color-text-subtle)" },
  error:    { border: "#EF4444", bg: "#FEF2F2", color: "#DC2626" },
};

const STATUS_ICON: Record<AgentStatus, string> = {
  pending: "○", running: "⚙", done: "✓", skipped: "—", error: "✕",
};

export default function PipelinePanel({ agentStates, agentOutputs, onRunAll, isRunning }: PipelinePanelProps) {
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [userInput, setUserInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const [difficultyOptions, setDifficultyOptions] = useState<string[]>([]);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const isMobileViewport = viewportWidth < 900;

  const seqBefore = PIPELINE_ORDER.filter((a) =>
    PIPELINE_ORDER.indexOf(a) < PIPELINE_ORDER.indexOf(AgentName.READING)
  );
  const parallelAgents = PIPELINE_ORDER.filter((a) => PARALLEL.has(a));
  const seqAfter = PIPELINE_ORDER.filter((a) =>
    PIPELINE_ORDER.indexOf(a) > PIPELINE_ORDER.indexOf(AgentName.ASSESSMENT)
  );

  function isStudioChatStorageMissing(message?: string | null) {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes("studio_chat_threads") ||
      normalized.includes("studio_chat_messages") ||
      normalized.includes("schema cache") ||
      normalized.includes("could not find the table")
    );
  }

  async function loadThreads(selectId?: string | null) {
    setThreadError(null);
    const res = await fetch("/api/studio-chat/threads", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMessage = payload.error ?? "프로젝트 목록을 불러오지 못했습니다.";
      if (isStudioChatStorageMissing(errorMessage)) {
        setStorageUnavailable(true);
        setThreads([]);
        setSelectedThreadId("local-thread");
        setThreadError("대화 저장용 테이블이 아직 없어 임시 프로젝트 모드로 동작합니다. 화면을 이동하면 기록은 사라집니다.");
        return null;
      }
      setThreadError(errorMessage);
      return [];
    }

    setStorageUnavailable(false);
    const nextThreads = (payload.threads ?? []) as StoredThread[];
    setThreads(nextThreads);
    const fallbackId =
      selectId && nextThreads.some((thread) => thread.id === selectId)
        ? selectId
        : nextThreads[0]?.id ?? null;
    setSelectedThreadId(fallbackId);
    return nextThreads;
  }

  async function createThread() {
    if (storageUnavailable) {
      setSelectedThreadId("local-thread");
      return "local-thread";
    }
    setThreadError(null);
    const res = await fetch("/api/studio-chat/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "새 프로젝트" }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setThreadError(payload.error ?? "새 프로젝트를 만들지 못했습니다.");
      return null;
    }
    const nextThread = payload.thread as StoredThread;
    setThreads((prev) => [nextThread, ...prev]);
    setSelectedThreadId(nextThread.id);
    return nextThread.id;
  }

  async function deleteThread(threadId: string) {
    if (storageUnavailable) {
      if (!window.confirm("임시 프로젝트를 비울까요?")) return;
      setSelectedThreadId(null);
      return;
    }
    if (!window.confirm("이 프로젝트만 삭제할까요? 저장된 학습자료는 삭제되지 않습니다.")) return;
    const res = await fetch(`/api/studio-chat/threads/${threadId}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setThreadError(payload.error ?? "프로젝트를 삭제하지 못했습니다.");
      return;
    }
    const remaining = threads.filter((thread) => thread.id !== threadId);
    setThreads(remaining);
    setSelectedThreadId(remaining[0]?.id ?? null);
  }

  async function savePipelinePrompt(threadId: string, text: string) {
    if (storageUnavailable || threadId === "local-thread") return;
    const title = text.slice(0, 80);
    const res = await fetch(`/api/studio-chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        text,
        title,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error ?? "프로젝트에 입력 내용을 저장하지 못했습니다.");
    }
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title: thread.messageCount > 0 ? thread.title : title,
              messageCount: thread.messageCount + 1,
              lastMessagePreview: text,
              lastMessageAt: payload.message?.created_at ?? new Date().toISOString(),
              updated_at: payload.message?.created_at ?? new Date().toISOString(),
            }
          : thread
      )
    );
  }

  useEffect(() => {
    const syncViewport = () => setViewportWidth(window.innerWidth);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoadingThreads(true);
      const savedThreadId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STUDIO_THREAD_STORAGE_KEY)
          : null;
      await loadThreads(savedThreadId);
      if (!cancelled) {
        setLoadingThreads(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDifficultyOptions() {
      try {
        const res = await fetch("/api/system-settings/code-values", { cache: "no-store" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const store = normalizeCodeValues(payload.codeValues);
        const options = getCodeValueItems(store, "difficulty").map((item) => item.label).filter(Boolean);
        if (!cancelled) {
          setDifficultyOptions(options);
        }
      } catch {
        if (!cancelled) {
          setDifficultyOptions([]);
        }
      }
    }

    void loadDifficultyOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedThreadId) {
      window.localStorage.setItem(STUDIO_THREAD_STORAGE_KEY, selectedThreadId);
    } else {
      window.localStorage.removeItem(STUDIO_THREAD_STORAGE_KEY);
    }
  }, [selectedThreadId]);

  function handleNodeClick(agent: AgentName) {
    const status = agentStates.get(agent) ?? "pending";
    if (status === "pending" || status === "running") return;
    setSelectedAgent(selectedAgent === agent ? null : agent);
  }

  async function handleExecute() {
    const nextInput = userInput.trim();
    if (!nextInput || isRunning) return;

    let threadId = selectedThreadId;
    if (!threadId) {
      threadId = await createThread();
      if (!threadId) return;
    }

    try {
      await savePipelinePrompt(threadId, nextInput);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : "프로젝트 저장 중 오류가 발생했습니다.");
      return;
    }

    onRunAll(nextInput);
  }

  function Node({ agent }: { agent: AgentName }) {
    const status = agentStates.get(agent) ?? "pending";
    const s = NODE_STYLE[status];
    const m = AGENT_META[agent];
    const isSelected = selectedAgent === agent;
    const isClickable = status !== "pending" && status !== "running";

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
        <div
          onClick={() => handleNodeClick(agent)}
          style={{
            width: "86px", padding: "8px 6px", borderRadius: "8px",
            background: isSelected ? s.border : s.bg,
            border: `${isSelected ? "2.5px" : "1.5px"} solid ${s.border}`,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
            textAlign: "center",
            cursor: isClickable ? "pointer" : "default",
            transition: "all .15s",
            boxShadow: isSelected ? `0 0 0 3px ${s.border}33` : "none",
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: "700", color: isSelected ? "#fff" : "var(--color-text-subtle)" }}>
            {m.num}
          </div>
          <div style={{ fontSize: "10px", fontWeight: "600", color: isSelected ? "#fff" : "var(--color-text)", lineHeight: "1.3" }}>
            {m.label.length > 10 ? m.label.slice(0, 10) + "…" : m.label}
          </div>
          <div style={{ fontSize: "9px", fontWeight: "600", color: isSelected ? "#ffffffcc" : s.color }}>
            {status === "running"
              ? <span style={{ display: "inline-block", animation: "spin .8s linear infinite" }}>⚙</span>
              : STATUS_ICON[status]
            }
            {" "}{status === "running" ? "실행중" : status === "done" ? "완료" : status === "skipped" ? "건너뜀" : status === "error" ? "오류" : "대기"}
          </div>
        </div>
      </div>
    );
  }

  function Arrow() {
    return (
      <div style={{ display: "flex", alignItems: "center", marginTop: "2px", flexShrink: 0 }}>
        <div style={{ width: "16px", height: "1px", background: "var(--color-border-strong)" }} />
        <div style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "5px solid var(--color-border-strong)" }} />
      </div>
    );
  }

  // Format JSON output for display
  function formatOutput(output: unknown): string {
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }

  const selectedMeta = selectedAgent ? AGENT_META[selectedAgent] : null;
  const selectedOutput = selectedAgent ? agentOutputs.get(selectedAgent) : undefined;
  const selectedStatus = selectedAgent ? (agentStates.get(selectedAgent) ?? "pending") : "pending";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>

      {/* Header with input */}
      <div style={{
        padding: isMobileViewport ? "12px" : "12px 20px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", gap: "10px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <select
            value={selectedThreadId ?? ""}
            onChange={(e) => setSelectedThreadId(e.target.value || null)}
            disabled={loadingThreads}
            style={{
              minWidth: "220px",
              maxWidth: "320px",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg)",
              fontSize: "12px",
              fontFamily: "inherit",
            }}
          >
            <option value="">{loadingThreads ? "프로젝트 불러오는 중..." : "프로젝트를 선택해 주세요"}</option>
            {storageUnavailable ? <option value="local-thread">임시 프로젝트</option> : null}
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void createThread()}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg)",
              fontSize: "12px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            + 새 프로젝트
          </button>
          <button
            type="button"
            onClick={() => selectedThreadId && void deleteThread(selectedThreadId)}
            disabled={!selectedThreadId}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #FECACA",
              background: selectedThreadId ? "#FEF2F2" : "#F8FAFC",
              color: selectedThreadId ? "#B91C1C" : "var(--color-text-subtle)",
              fontSize: "12px",
              fontWeight: "700",
              cursor: selectedThreadId ? "pointer" : "not-allowed",
            }}
          >
            삭제
          </button>
          <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
            파이프라인 실행 기록도 현재 프로젝트 기준으로 이어집니다.
          </div>
        </div>

        {threadError ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #FECACA",
              background: "#FEF2F2",
              color: "#B91C1C",
              fontSize: "11px",
              lineHeight: 1.6,
            }}
          >
            {threadError}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text)" }}>파이프라인 실행</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>완료된 노드를 클릭하면 결과를 확인할 수 있습니다</div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "flex-end",
            background: "var(--color-bg)", border: "1.5px solid var(--color-border-strong)",
            borderRadius: "8px", padding: "7px 10px",
            transition: "border-color .15s",
          }}
            onFocusCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-primary)"; }}
            onBlurCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)"; }}
          >
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (userInput.trim() && !isRunning) {
                    void handleExecute();
                  }
                }
              }}
              placeholder="예: 초등 5학년 intermediate 환경 보호 주제로 레슨 만들어줘"
              rows={1}
              disabled={isRunning || (!selectedThreadId && !storageUnavailable)}
              style={{
                flex: 1, resize: "none", border: "none", background: "transparent",
                fontSize: "12px", color: "var(--color-text)", outline: "none",
                fontFamily: "inherit", lineHeight: "1.5",
              }}
            />
          </div>
          <button
            onClick={() => {
              void handleExecute();
            }}
            disabled={!userInput.trim() || isRunning || (!selectedThreadId && !storageUnavailable)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", borderRadius: "7px", flexShrink: 0,
              background:
                !userInput.trim() || isRunning || (!selectedThreadId && !storageUnavailable)
                  ? "var(--color-border-strong)"
                  : "var(--color-primary)",
              color:
                !userInput.trim() || isRunning || (!selectedThreadId && !storageUnavailable)
                  ? "var(--color-text-muted)"
                  : "#fff",
              fontSize: "12px", fontWeight: "600",
              border: "none",
              cursor:
                !userInput.trim() || isRunning || (!selectedThreadId && !storageUnavailable)
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1.5l8 4-8 4V1.5z" fill="currentColor"/></svg>
            {isRunning ? "실행 중..." : "실행"}
          </button>
        </div>
      </div>

      {/* Flow diagram */}
      <div style={{ padding: "20px 16px", overflowX: "auto", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0", minWidth: "max-content" }}>

          {seqBefore.map((agent, idx) => (
            <div key={agent} style={{ display: "flex", alignItems: "center" }}>
              <Node agent={agent} />
              <Arrow />
            </div>
          ))}

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", margin: "0 4px" }}>
            <div style={{ fontSize: "9px", fontWeight: "600", color: "var(--color-text-subtle)", marginBottom: "4px", letterSpacing: ".3px" }}>── 병렬 실행 ──</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {parallelAgents.map((agent) => (
                <div key={agent} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ width: "10px", height: "1px", background: "var(--color-border-strong)" }} />
                  <Node agent={agent} />
                  <div style={{ width: "10px", height: "1px", background: "var(--color-border-strong)" }} />
                </div>
              ))}
            </div>
          </div>

          <Arrow />

          {seqAfter.map((agent, idx) => (
            <div key={agent} style={{ display: "flex", alignItems: "center" }}>
              <Node agent={agent} />
              {idx < seqAfter.length - 1 && <Arrow />}
            </div>
          ))}
        </div>
      </div>

      {/* Agent detail panel (shows on click) */}
      {selectedAgent && selectedMeta && (
        <div style={{
          background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)",
          flexShrink: 0, maxHeight: "320px", display: "flex", flexDirection: "column",
        }}>
          {/* Detail header */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <div style={{
              padding: "3px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: "700",
              background: NODE_STYLE[selectedStatus].bg, color: NODE_STYLE[selectedStatus].color,
              border: `1px solid ${NODE_STYLE[selectedStatus].border}`,
            }}>
              {selectedMeta.num} {selectedMeta.label}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", flex: 1 }}>{selectedMeta.desc}</div>
            <button
              onClick={() => setSelectedAgent(null)}
              style={{ width: "22px", height: "22px", borderRadius: "4px", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >✕</button>
          </div>

          {/* Output content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
            {selectedOutput === undefined ? (
              <div style={{ fontSize: "12px", color: "var(--color-text-subtle)", fontStyle: "italic" }}>
                {selectedStatus === "skipped" ? "이 에이전트는 건너뛰었습니다." : "출력 데이터가 없습니다."}
              </div>
            ) : (
              <pre style={{
                fontSize: "11px", lineHeight: "1.6", color: "var(--color-text)",
                background: "var(--color-bg)", border: "1px solid var(--color-border)",
                borderRadius: "6px", padding: "10px 12px",
                overflow: "auto", margin: 0,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {formatOutput(selectedOutput)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Config area */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobileViewport ? "12px" : "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobileViewport ? "1fr" : "1fr 1fr", gap: "12px" }}>

          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "10px" }}>
              🤖 에이전트별 AI 제공자
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {[AgentName.INTENT_ROUTER, AgentName.PASSAGE_GENERATION, AgentName.READING, AgentName.QA].map((a) => (
                <div key={a} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{AGENT_META[a].label}</span>
                  <select style={{
                    width: "110px", padding: "4px 7px", borderRadius: "5px",
                    border: "1px solid var(--color-border-strong)", fontSize: "11px",
                    color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit",
                  }}>
                    <option>Claude (기본)</option>
                    <option>GPT-4o</option>
                    <option>Gemini</option>
                  </select>
                </div>
              ))}
              <div style={{ textAlign: "center", marginTop: "2px" }}>
                <span style={{ fontSize: "11px", color: "var(--color-primary)", cursor: "pointer" }}>+ 16개 전체 설정 보기</span>
              </div>
            </div>
          </div>

          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "10px" }}>
              ⚙️ 파이프라인 설정
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {[
                { label: "난이도", opts: difficultyOptions.length > 0 ? difficultyOptions : ["등록된 난이도 코드값이 없습니다"] },
                { label: "시작 에이전트", opts: ["1. intent_router (처음부터)", "7. passage_generation (지문부터)", "10. reading (콘텐츠부터)"] },
                { label: "종료 에이전트", opts: ["16. publisher (전체)", "9. approved_passage_lock (지문까지)", "14. assessment (콘텐츠까지)"] },
              ].map(({ label, opts }) => (
                <div key={label}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "3px" }}>{label}</div>
                  <select style={{
                    width: "100%", padding: "5px 8px", borderRadius: "6px",
                    border: "1px solid var(--color-border-strong)", fontSize: "11px",
                    color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit",
                  }}>
                    {opts.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
