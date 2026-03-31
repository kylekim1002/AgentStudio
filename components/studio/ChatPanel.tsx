"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { AgentName, AgentStatus, LessonPackage } from "@/lib/agents/types";
import { AGENT_META, PIPELINE_ORDER } from "@/lib/agentMeta";

// ─── Message types ───────────────────────────────────────────

type UserMsg    = { type: "user";   text: string; ts: Date };
type AIMsg      = { type: "ai";     text: string; ts: Date };
type AgentEvent = { type: "event";  agent: AgentName; status: AgentStatus; desc?: string };
type ErrorMsg   = { type: "error";  text: string };
type ResultMsg  = { type: "result"; pkg: LessonPackage };

type ChatMsg = UserMsg | AIMsg | AgentEvent | ErrorMsg | ResultMsg;

// ─── Props ───────────────────────────────────────────────────

interface ChatPanelProps {
  agentStates: Map<AgentName, AgentStatus>;
  isRunning: boolean;
  lessonPackage: LessonPackage | null;
  error: string | null;
  onSend: (text: string) => void;
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

// ─── Mention popup ────────────────────────────────────────────

const MENTION_AGENTS = [
  { key: "all",                  label: "@all",                  desc: "전체 파이프라인 실행" },
  ...PIPELINE_ORDER.map((a) => ({
    key: AGENT_META[a].mention,
    label: `@${AGENT_META[a].mention}`,
    desc: AGENT_META[a].label,
  })),
];

function fmt(d: Date) {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel({ agentStates, isRunning, lessonPackage, error, onSend, onReset }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = hidden
  const [mentionIdx, setMentionIdx] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevRunning = useRef(false);
  const prevStates  = useRef<Map<AgentName, AgentStatus>>(new Map());

  // ── Auto-scroll ──────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Sync agent state events into chat ───────────────────────
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
        setMessages((prev) => [...prev, { type: "event", agent, status, desc }]);
      }
    });
    prevStates.current = new Map(agentStates);
  }, [agentStates]);

  // ── On complete ──────────────────────────────────────────────
  useEffect(() => {
    if (lessonPackage && !prevRunning.current) return;
    if (lessonPackage) {
      setMessages((prev) => [
        ...prev,
        { type: "ai", text: `레슨 패키지가 완성되었습니다! 우측 미리보기에서 확인하고 PDF/DOCX로 내보낼 수 있습니다.`, ts: new Date() },
        { type: "result", pkg: lessonPackage },
      ]);
    }
    prevRunning.current = isRunning;
  }, [lessonPackage]);

  // ── On error ────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      setMessages((prev) => [...prev, { type: "error", text: error }]);
    }
  }, [error]);

  // ── Textarea auto-height ─────────────────────────────────────
  function adjustHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  // ── @ mention detection ──────────────────────────────────────
  function detectMention(val: string) {
    const atIdx = val.lastIndexOf("@");
    if (atIdx === -1) { setMentionQuery(null); return; }
    const after = val.slice(atIdx + 1);
    if (/\s/.test(after)) { setMentionQuery(null); return; }
    setMentionQuery(after.toLowerCase());
    setMentionIdx(0);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    adjustHeight();
    detectMention(e.target.value);
  }

  // ── Mention select ───────────────────────────────────────────
  const filteredMentions = mentionQuery !== null
    ? MENTION_AGENTS.filter((m) => m.key.includes(mentionQuery) || m.desc.includes(mentionQuery))
    : [];

  function selectMention(key: string) {
    const atIdx = input.lastIndexOf("@");
    setInput(input.slice(0, atIdx) + "@" + key + " ");
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  // ── Send ─────────────────────────────────────────────────────
  function send() {
    const text = input.trim();
    if (!text || isRunning) return;
    setMessages((prev) => [...prev, { type: "user", text, ts: new Date() }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMentionQuery(null);
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectMention(filteredMentions[mentionIdx].key); return; }
      if (e.key === "Escape")    { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // ── Quick prompts ─────────────────────────────────────────────
  const QUICK = [
    { icon: "🌿", text: "초등 5학년 intermediate 환경 보호 주제로 레슨 만들어줘" },
    { icon: "🚀", text: "중학교 1학년 elementary 우주 탐험 레슨 만들어줘" },
    { icon: "🤖", text: "고등학교 advanced AI 기술 레슨 만들어줘" },
    { icon: "📄", text: "@passage_generation 지문을 직접 제공해서 문제만 만들어줘" },
  ];

  const isEmpty = messages.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>

      {/* ── Messages area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>

        {isEmpty ? (
          /* Empty state */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", paddingTop: "60px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "var(--color-primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
              ⚡
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", textAlign: "center" }}>레슨을 만들어 보세요</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-muted)", textAlign: "center", marginTop: "6px", lineHeight: "1.6" }}>
                주제, 난이도, 대상 학년을 알려주시면<br/>AI 에이전트가 완성된 레슨 패키지를 만들어 드립니다.
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center", maxWidth: "400px" }}>
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
                  {q.icon} {q.text.length > 22 ? q.text.slice(0, 22) + "…" : q.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
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
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary)", color: "#fff", fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>K</div>
              </div>
            );

            if (msg.type === "ai") return (
              <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>AI</div>
                <div>
                  <div style={{
                    background: "var(--color-surface)", border: "1px solid var(--color-border)",
                    padding: "10px 14px", borderRadius: "4px 12px 12px 12px",
                    fontSize: "13px", lineHeight: "1.6", maxWidth: "420px",
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
                <button onClick={onReset} style={{ marginLeft: "10px", fontSize: "11px", color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
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
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* ── Input area ── */}
      <div style={{ padding: "10px 16px 12px", background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", position: "relative" }}>

        {/* Mention popup */}
        {mentionQuery !== null && filteredMentions.length > 0 && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 4px)", left: "16px",
            background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: "9px", boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            overflow: "hidden", zIndex: 50, width: "280px",
          }}>
            <div style={{ padding: "7px 12px 5px", fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", borderBottom: "1px solid var(--color-border)", letterSpacing: ".4px", textTransform: "uppercase" }}>
              에이전트 선택
            </div>
            <div style={{ maxHeight: "200px", overflowY: "auto" }}>
              {filteredMentions.slice(0, 10).map((m, idx) => (
                <div
                  key={m.key}
                  onMouseDown={(e) => { e.preventDefault(); selectMention(m.key); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "7px 12px", cursor: "pointer",
                    background: idx === mentionIdx ? "var(--color-primary-light)" : "transparent",
                    transition: ".1s",
                  }}
                  onMouseEnter={() => setMentionIdx(idx)}
                >
                  <div style={{
                    width: "24px", height: "24px", borderRadius: "5px",
                    background: "var(--color-bg)", border: "1px solid var(--color-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "9px", fontWeight: "700", color: "var(--color-primary)", flexShrink: 0,
                  }}>
                    {m.key === "all" ? "ALL" : m.key.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text)" }}>{m.label}</div>
                    <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>{m.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input box */}
        <div style={{
          display: "flex", alignItems: "flex-end", gap: "8px",
          background: "var(--color-bg)", border: "1.5px solid var(--color-border-strong)",
          borderRadius: "10px", padding: "8px 10px",
          transition: "border-color .15s",
        }}
          onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-primary)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)"; }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="레슨 요청을 입력하세요 — @ 입력으로 에이전트 지정"
            rows={1}
            disabled={isRunning}
            style={{
              flex: 1, resize: "none", border: "none", background: "transparent",
              fontSize: "13px", color: "var(--color-text)", outline: "none",
              fontFamily: "inherit", lineHeight: "1.5", minHeight: "20px", maxHeight: "120px",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
            {/* Attach button */}
            <button style={{ width: "28px", height: "28px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
              title="파일 첨부">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7L7 12a3.5 3.5 0 01-5-5l5.5-5.5a2 2 0 012.8 2.8L5 9.5a.7.7 0 01-1-1L9.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
            </button>
            {/* Send button */}
            <button
              onClick={send}
              disabled={!input.trim() || isRunning}
              style={{
                width: "32px", height: "32px", borderRadius: "7px",
                background: !input.trim() || isRunning ? "var(--color-border-strong)" : "var(--color-primary)",
                color: !input.trim() || isRunning ? "var(--color-text-subtle)" : "#fff",
                border: "none", cursor: !input.trim() || isRunning ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", transition: ".15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 12L6.5 1 12 12M3 9h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* Hint row */}
        <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "6px", paddingLeft: "2px" }}>
          <strong style={{ color: "var(--color-primary)" }}>@all</strong> 전체 파이프라인 &nbsp;·&nbsp;
          <strong style={{ color: "var(--color-primary)" }}>@passage_generation</strong> 지문만 &nbsp;·&nbsp;
          <kbd style={{ background: "var(--color-border)", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>⏎</kbd> 전송 &nbsp;
          <kbd style={{ background: "var(--color-border)", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>Shift+⏎</kbd> 줄바꿈
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
