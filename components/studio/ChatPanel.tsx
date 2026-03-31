"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { AgentName, AgentStatus, LessonPackage } from "@/lib/agents/types";
import { AGENT_META } from "@/lib/agentMeta";

// ─── Message types ───────────────────────────────────────────

type UserMsg    = { type: "user";   text: string; ts: Date };
type AIMsg      = { type: "ai";     text: string; ts: Date };
type AgentEvent = { type: "event";  agent: AgentName; status: AgentStatus; desc?: string };
type ErrorMsg   = { type: "error";  text: string };
type ResultMsg  = { type: "result"; pkg: LessonPackage };

type DisplayMsg = UserMsg | AIMsg | AgentEvent | ErrorMsg | ResultMsg;

type ChatHistory = { role: "user" | "assistant"; content: string }[];

// ─── Props ───────────────────────────────────────────────────

interface ChatPanelProps {
  agentStates: Map<AgentName, AgentStatus>;
  isRunning: boolean;
  lessonPackage: LessonPackage | null;
  error: string | null;
  onConfirmGenerate: (chatSummary: string) => void;
  onReset: () => void;
}

// ─── Agent status colours ─────────────────────────────────────

const EVT_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  running: { bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE" },
  done:    { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0" },
  skipped: { bg: "#F8FAFC", text: "#94A3B8", border: "#E2E8F0" },
  error:   { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
};

const EVT_ICON: Record<string, string> = {
  running: "⚙️", done: "✅", skipped: "⏭", error: "❌",
};

function fmt(d: Date) {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ─── Quick prompt starters ────────────────────────────────────

const QUICK = [
  { icon: "🌿", text: "초등 5학년 환경 보호 주제로 레슨 만들어줘" },
  { icon: "🚀", text: "중학교 1학년 우주 탐험 레슨 만들어줘" },
  { icon: "🤖", text: "고등학교 advanced AI 기술 레슨 만들어줘" },
  { icon: "📄", text: "직접 지문을 제공해서 문제만 만들어줘" },
];

export default function ChatPanel({
  agentStates, isRunning, lessonPackage, error, onConfirmGenerate, onReset,
}: ChatPanelProps) {
  const [displayMessages, setDisplayMessages] = useState<DisplayMsg[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistory>([]);
  const [input, setInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showConfirmButton, setShowConfirmButton] = useState(false);

  const chatEndRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevStates  = useRef<Map<AgentName, AgentStatus>>(new Map());
  const prevRunning = useRef(false);

  // ── Auto-scroll ──────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingText]);

  // ── Sync agent events into chat (during pipeline run) ────────
  useEffect(() => {
    agentStates.forEach((status, agent) => {
      const prev = prevStates.current.get(agent);
      if (prev !== status && status !== "pending") {
        const m = AGENT_META[agent];
        const desc =
          status === "done"    ? `${m.label} — 완료` :
          status === "running" ? `${m.label} 실행 중...` :
          status === "skipped" ? `${m.label} — 건너뜀` :
          status === "error"   ? `${m.label} — 오류 발생` : "";
        setDisplayMessages((prev) => [...prev, { type: "event", agent, status, desc }]);
      }
    });
    prevStates.current = new Map(agentStates);
  }, [agentStates]);

  // ── On pipeline complete ─────────────────────────────────────
  useEffect(() => {
    if (lessonPackage && prevRunning.current) {
      setDisplayMessages((prev) => [
        ...prev,
        { type: "ai", text: "레슨 패키지가 완성되었습니다! 우측 미리보기에서 확인하고 PDF/DOCX로 내보낼 수 있습니다. 🎉", ts: new Date() },
        { type: "result", pkg: lessonPackage },
      ]);
    }
    prevRunning.current = isRunning;
  }, [lessonPackage]);

  // ── On pipeline error ────────────────────────────────────────
  useEffect(() => {
    if (error) {
      setDisplayMessages((prev) => [...prev, { type: "error", text: error }]);
    }
  }, [error]);

  // ── Textarea auto-height ─────────────────────────────────────
  function adjustHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    adjustHeight();
  }

  // ── Send to /api/chat (conversational) ───────────────────────
  async function send() {
    const text = input.trim();
    if (!text || isAiThinking || isRunning) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setShowConfirmButton(false);

    // Add user message to display + history
    const userTs = new Date();
    setDisplayMessages((prev) => [...prev, { type: "user", text, ts: userTs }]);
    const newHistory: ChatHistory = [...chatHistory, { role: "user", content: text }];
    setChatHistory(newHistory);

    setIsAiThinking(true);
    setStreamingText("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory }),
      });

      if (!res.ok || !res.body) throw new Error("Chat request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullText += parsed.text;
              setStreamingText(fullText);
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch (e) {
            if ((e as Error).message !== "Unexpected token") throw e;
          }
        }
      }

      const aiTs = new Date();
      setDisplayMessages((prev) => [...prev, { type: "ai", text: fullText, ts: aiTs }]);
      setChatHistory([...newHistory, { role: "assistant", content: fullText }]);
      setStreamingText("");

      // Show confirm button when AI signals readiness
      if (fullText.includes("레슨 생성을 시작하세요")) {
        setShowConfirmButton(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setDisplayMessages((prev) => [...prev, { type: "error", text: msg }]);
      setStreamingText("");
    } finally {
      setIsAiThinking(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // ── Confirm → start pipeline ──────────────────────────────────
  function handleConfirm() {
    setShowConfirmButton(false);
    // Build a summary string from last assistant message (full history context)
    const lastAssistant = [...chatHistory].reverse().find((m) => m.role === "assistant");
    const summary = lastAssistant?.content ?? "";
    onConfirmGenerate(summary);
    setDisplayMessages((prev) => [...prev, {
      type: "ai",
      text: "알겠습니다! 지금 바로 레슨 생성을 시작합니다 🚀",
      ts: new Date(),
    }]);
  }

  // ── Reset ────────────────────────────────────────────────────
  function handleReset() {
    setDisplayMessages([]);
    setChatHistory([]);
    setStreamingText("");
    setShowConfirmButton(false);
    onReset();
  }

  const isEmpty = displayMessages.length === 0 && !streamingText;
  const isBusy  = isAiThinking || isRunning;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>

      {/* ── Messages area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>

        {isEmpty ? (
          /* Empty / welcome state */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", paddingTop: "60px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "var(--color-primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
              💬
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", textAlign: "center" }}>어떤 레슨을 만들어 드릴까요?</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-muted)", textAlign: "center", marginTop: "6px", lineHeight: "1.6" }}>
                학년, 주제, 난이도를 알려주시면 함께 레슨을 기획해 드립니다.<br/>확정 후 버튼을 누르면 AI가 레슨 패키지를 자동 생성합니다.
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center", maxWidth: "420px" }}>
              {QUICK.map((q) => (
                <button
                  key={q.text}
                  onClick={() => { setInput(q.text); textareaRef.current?.focus(); }}
                  style={{
                    padding: "6px 14px", borderRadius: "20px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)", color: "var(--color-text-muted)",
                    fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px",
                    transition: "all .15s",
                  }}
                  onMouseOver={(e) => {
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
                  {q.icon} {q.text.length > 24 ? q.text.slice(0, 24) + "…" : q.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {displayMessages.map((msg, i) => {
              if (msg.type === "user") return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "flex-end" }}>
                  <div>
                    <div style={{
                      background: "var(--color-primary)", color: "#fff",
                      padding: "10px 14px", borderRadius: "12px 4px 12px 12px",
                      fontSize: "13px", lineHeight: "1.6", maxWidth: "420px",
                      whiteSpace: "pre-wrap",
                    }}>
                      {msg.text}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", textAlign: "right", marginTop: "3px" }}>{fmt(msg.ts)}</div>
                  </div>
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary)", color: "#fff", fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>T</div>
                </div>
              );

              if (msg.type === "ai") return (
                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>AI</div>
                  <div>
                    <div style={{
                      background: "var(--color-surface)", border: "1px solid var(--color-border)",
                      padding: "10px 14px", borderRadius: "4px 12px 12px 12px",
                      fontSize: "13px", lineHeight: "1.6", maxWidth: "440px",
                      whiteSpace: "pre-wrap",
                    }}>
                      {msg.text}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "3px" }}>{fmt(msg.ts)}</div>
                  </div>
                </div>
              );

              if (msg.type === "event") {
                const c = EVT_COLOR[msg.status] ?? EVT_COLOR.running;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    background: c.bg, border: `1px solid ${c.border}`,
                    borderRadius: "8px", padding: "8px 12px",
                  }}>
                    <span style={{ fontSize: "14px", flexShrink: 0 }}>{EVT_ICON[msg.status] ?? "•"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: c.text }}>{msg.desc}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "1px" }}>{AGENT_META[msg.agent].num} / {AGENT_META[msg.agent].mention}</div>
                    </div>
                    {msg.status === "running" && (
                      <div style={{ width: "14px", height: "14px", border: `2px solid ${c.text}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                    )}
                  </div>
                );
              }

              if (msg.type === "error") return (
                <div key={i} style={{
                  background: "#FEF2F2", border: "1px solid #FECACA",
                  borderRadius: "8px", padding: "10px 14px",
                  fontSize: "13px", color: "#DC2626", lineHeight: "1.5",
                }}>
                  ❌ {msg.text}
                  <button onClick={handleReset} style={{ marginLeft: "10px", fontSize: "11px", color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                    초기화
                  </button>
                </div>
              );

              if (msg.type === "result") return (
                <div key={i} style={{
                  background: "var(--color-surface)", border: "1px solid var(--color-border)",
                  borderRadius: "10px", padding: "12px 14px",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text)", marginBottom: "4px" }}>
                    📚 {msg.pkg.title}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[
                      { label: msg.pkg.difficulty, color: "#4F46E5" },
                      { label: `${msg.pkg.wordCount} words`, color: "#64748B" },
                      { label: `독해 ${msg.pkg.reading.questions.length}문항`, color: "#64748B" },
                      { label: `어휘 ${msg.pkg.vocabulary.words.length}개`, color: "#64748B" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: "#EEF2FF", color }}>{label}</span>
                    ))}
                  </div>
                </div>
              );

              return null;
            })}

            {/* ── Streaming AI response (in-progress) ── */}
            {streamingText && (
              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>AI</div>
                <div style={{
                  background: "var(--color-surface)", border: "1px solid var(--color-border)",
                  padding: "10px 14px", borderRadius: "4px 12px 12px 12px",
                  fontSize: "13px", lineHeight: "1.6", maxWidth: "440px",
                  whiteSpace: "pre-wrap",
                }}>
                  {streamingText}
                  <span style={{ display: "inline-block", width: "2px", height: "14px", background: "var(--color-primary)", marginLeft: "2px", animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />
                </div>
              </div>
            )}

            {/* ── Thinking indicator ── */}
            {isAiThinking && !streamingText && (
              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>AI</div>
                <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", padding: "10px 14px", borderRadius: "4px 12px 12px 12px", display: "flex", gap: "5px", alignItems: "center" }}>
                  {[0, 160, 320].map((delay) => (
                    <div key={delay} style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--color-primary)", opacity: 0.5, animation: `bounce 1s ${delay}ms ease-in-out infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Confirm button banner ── */}
      {showConfirmButton && !isRunning && (
        <div style={{
          padding: "10px 16px",
          background: "linear-gradient(135deg, #EFF6FF, #F0FDF4)",
          borderTop: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <div style={{ flex: 1, fontSize: "12px", color: "var(--color-text-muted)", lineHeight: "1.4" }}>
            레슨 정보가 확인되었습니다. 아래 버튼을 눌러 생성을 시작하세요.
          </div>
          <button
            onClick={handleConfirm}
            style={{
              padding: "8px 18px", borderRadius: "8px",
              background: "var(--color-primary)", color: "#fff",
              fontSize: "13px", fontWeight: "700",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
              boxShadow: "0 2px 8px rgba(79,70,229,.35)",
              flexShrink: 0,
            }}
          >
            🚀 레슨 생성 시작
          </button>
        </div>
      )}

      {/* ── Input area ── */}
      <div style={{ padding: "10px 16px 12px", background: "var(--color-surface)", borderTop: "1px solid var(--color-border)" }}>
        <div style={{
          display: "flex", alignItems: "flex-end", gap: "8px",
          background: "var(--color-bg)", border: "1.5px solid var(--color-border-strong)",
          borderRadius: "10px", padding: "8px 10px",
          transition: "border-color .15s",
        }}
          onFocusCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-primary)"; }}
          onBlurCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)"; }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isBusy ? "잠시 기다려 주세요..." : "레슨 계획에 대해 이야기해 보세요"}
            rows={1}
            disabled={isBusy}
            style={{
              flex: 1, resize: "none", border: "none", background: "transparent",
              fontSize: "13px", color: "var(--color-text)", outline: "none",
              fontFamily: "inherit", lineHeight: "1.5", minHeight: "20px", maxHeight: "120px",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || isBusy}
            style={{
              width: "32px", height: "32px", borderRadius: "7px",
              background: !input.trim() || isBusy ? "var(--color-border-strong)" : "var(--color-primary)",
              color: !input.trim() || isBusy ? "var(--color-text-subtle)" : "#fff",
              border: "none", cursor: !input.trim() || isBusy ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: ".15s",
              flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 12L6.5 1 12 12M3 9h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "6px", paddingLeft: "2px" }}>
          AI와 대화로 레슨을 기획하세요 &nbsp;·&nbsp;
          <kbd style={{ background: "var(--color-border)", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>⏎</kbd> 전송 &nbsp;
          <kbd style={{ background: "var(--color-border)", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>Shift+⏎</kbd> 줄바꿈
        </div>
      </div>

      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes blink  { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>
    </div>
  );
}
