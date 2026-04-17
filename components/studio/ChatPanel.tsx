"use client";

import { useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { AgentName, AgentStatus, LessonPackage } from "@/lib/agents/types";
import {
  AGENT_META,
  CALLABLE_AGENT_ORDER,
  getAgentMentionTokens,
  resolveAgentMention,
} from "@/lib/agentMeta";
import { buildLevelContextText, LevelSetting } from "@/lib/levelSettings";

type UserMsg = { type: "user"; text: string; ts: Date };
type AIMsg = { type: "ai"; text: string; ts: Date; agentName?: AgentName };
type AgentEvent = { type: "event"; agent: AgentName; status: AgentStatus; desc?: string };
type ErrorMsg = { type: "error"; text: string };
type ResultMsg = { type: "result"; pkg: LessonPackage };
type DisplayMsg = UserMsg | AIMsg | AgentEvent | ErrorMsg | ResultMsg;
type ChatHistory = { role: "user" | "assistant"; content: string }[];
type ChatMessageLike = { role: "user" | "assistant"; content: string };

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

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  agent_name: string | null;
  created_at: string;
}

function isNearDuplicateStoredMessage(
  a: StoredMessage | null | undefined,
  b: StoredMessage | null | undefined
) {
  if (!a || !b) return false;
  if (a.role !== b.role) return false;
  if ((a.text ?? "").trim() !== (b.text ?? "").trim()) return false;
  if ((a.agent_name ?? null) !== (b.agent_name ?? null)) return false;
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return false;
  return Math.abs(aTime - bTime) < 5000;
}

function dedupeStoredMessages(messages: StoredMessage[]) {
  const deduped: StoredMessage[] = [];
  for (const message of messages) {
    const prev = deduped[deduped.length - 1];
    if (isNearDuplicateStoredMessage(prev, message)) {
      deduped[deduped.length - 1] = message;
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

interface ChatPanelProps {
  provider: string;
  agentStates: Map<AgentName, AgentStatus>;
  isRunning: boolean;
  lessonPackage: LessonPackage | null;
  error: string | null;
  onConfirmGenerate: (chatSummary: string) => void;
  onRetryFailedGenerate: (chatSummary: string, failedAgent: AgentName) => void;
  onReset: () => void;
  approvalMode: "auto" | "require_review";
  selectedLevel: LevelSetting | null;
  failedAgentName: AgentName | null;
}

const EVT_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  running: { bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE" },
  done: { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0" },
  skipped: { bg: "#F8FAFC", text: "#94A3B8", border: "#E2E8F0" },
  error: { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
};

const EVT_ICON: Record<string, string> = {
  running: "⚙️",
  done: "✅",
  skipped: "⏭",
  error: "❌",
};

const QUICK = [
  { icon: "🌿", text: "초등 5학년 환경 보호 주제로 레슨 만들어줘" },
  { icon: "🚀", text: "중학교 1학년 우주 탐험 레슨 만들어줘" },
  { icon: "🤖", text: "고등학교 advanced AI 기술 레슨 만들어줘" },
  { icon: "📄", text: "직접 지문을 제공해서 문제만 만들어줘" },
];

const STUDIO_THREAD_STORAGE_KEY = "cyj-studio:selected-thread-id";
const STUDIO_THREAD_PANEL_COLLAPSED_KEY = "cyj-studio:thread-panel-collapsed";

function fmt(d: Date) {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatThreadTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDisplayMessages(messages: StoredMessage[]): DisplayMsg[] {
  return dedupeStoredMessages(messages).map((message) =>
    message.role === "user"
      ? {
          type: "user",
          text: message.text,
          ts: new Date(message.created_at),
        }
      : {
          type: "ai",
          text: message.text,
          ts: new Date(message.created_at),
          agentName: (message.agent_name as AgentName | null) ?? undefined,
        }
  );
}

function toChatHistory(messages: StoredMessage[]): ChatHistory {
  return messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

export default function ChatPanel({
  provider,
  agentStates,
  isRunning,
  lessonPackage,
  error,
  onConfirmGenerate,
  onRetryFailedGenerate,
  onReset,
  approvalMode,
  selectedLevel,
  failedAgentName,
}: ChatPanelProps) {
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [storedMessages, setStoredMessages] = useState<StoredMessage[]>([]);
  const [ephemeralMessages, setEphemeralMessages] = useState<DisplayMsg[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [isThreadPanelCollapsed, setIsThreadPanelCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showConfirmButton, setShowConfirmButton] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"generate" | "retry">("generate");
  const [activeAgentName, setActiveAgentName] = useState<AgentName | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevStates = useRef<Map<AgentName, AgentStatus>>(new Map());
  const prevRunning = useRef(false);
  const sendLockRef = useRef(false);
  const isComposingRef = useRef(false);
  const suppressNextCompositionEndRef = useRef(false);
  const lastSendRef = useRef<{ signature: string; at: number } | null>(null);
  const lastFailureReportRef = useRef<string | null>(null);

  const displayMessages = useMemo(
    () => [...toDisplayMessages(storedMessages), ...ephemeralMessages],
    [storedMessages, ephemeralMessages]
  );
  const chatHistory = useMemo(() => toChatHistory(storedMessages), [storedMessages]);
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );
  const levelContextText = useMemo(() => buildLevelContextText(selectedLevel), [selectedLevel]);
  const isMobileViewport = viewportWidth < 900;
  const retryIntentPattern =
    /다시 진행|재시도|재생성|다시 실행|수정해서 진행|수정 후 진행|실패 원인 반영|해당 부분만 수정|문제점 파악|원인 파악|수정 진행|수정해|다시 해줘|다시 시작|전달해서 다시|다시 만들어|고쳐서 다시|실패한 부분 다시/;
  const retryContextPattern = /실패|원인|해당 부분|해당 단계|해당 에이전트|검증기|생성기|수정/;

  function buildRetrySummary(messages: ChatMessageLike[], fallback: string) {
    const transcript = messages
      .map((message) => `${message.role === "user" ? "교사" : "AI"}: ${message.content}`)
      .join("\n");
    return transcript
      ? `다음은 실패 원인 분석과 재진행 전 대화 기록입니다. 사용자의 수정 요청과 실패 원인 지적을 반영해 해당 단계부터 다시 진행하세요.\n\n${transcript}`
      : fallback;
  }

  function updateThreadMetaLocally(threadId: string, patch: Partial<StoredThread>) {
    setThreads((prev) =>
      prev.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread))
    );
  }

  function isStudioChatStorageMissing(message?: string | null) {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes("studio_chat_threads") ||
      normalized.includes("studio_chat_messages") ||
      normalized.includes("studio_chat_messages.text") ||
      (normalized.includes("column") && normalized.includes("text does not exist")) ||
      normalized.includes("schema cache") ||
      normalized.includes("could not find the table")
    );
  }

  async function loadThreads(selectId?: string | null): Promise<StoredThread[] | null> {
    setThreadError(null);
    const res = await fetch("/api/studio-chat/threads", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMessage = payload.error ?? "대화 목록을 불러오지 못했습니다.";
      if (isStudioChatStorageMissing(errorMessage)) {
        setStorageUnavailable(true);
        setThreads([]);
        setSelectedThreadId("local-thread");
        setThreadError("대화 저장용 테이블이 아직 없어 임시 대화 모드로 동작합니다. 채팅은 계속 가능하지만, 화면을 이동하면 대화는 사라집니다.");
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

  async function loadMessages(threadId: string) {
    if (storageUnavailable) {
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    setThreadError(null);
    setEphemeralMessages([]);
    setShowConfirmButton(false);
    setConfirmMode("generate");
    try {
      const res = await fetch(`/api/studio-chat/threads/${threadId}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) {
        setThreadError(payload.error ?? "대화 내용을 불러오지 못했습니다.");
        setStoredMessages([]);
        return;
      }
      setStoredMessages(dedupeStoredMessages((payload.messages ?? []) as StoredMessage[]));
    } finally {
      setLoadingMessages(false);
    }
  }

  async function createThread(resetStudio = false) {
    if (storageUnavailable) {
      setSelectedThreadId("local-thread");
      setStoredMessages([]);
      setEphemeralMessages([]);
      setShowConfirmButton(false);
      setConfirmMode("generate");
      setActiveAgentName(null);
      if (resetStudio) {
        onReset();
      }
      return "local-thread";
    }
    setThreadError(null);
    const res = await fetch("/api/studio-chat/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "새 프로젝트" }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setThreadError(payload.error ?? "새 프로젝트를 만들지 못했습니다.");
      return null;
    }

    const nextThread = payload.thread as StoredThread;
    setThreads((prev) => [nextThread, ...prev]);
    setSelectedThreadId(nextThread.id);
    setStoredMessages([]);
    setEphemeralMessages([]);
    setShowConfirmButton(false);
    setConfirmMode("generate");
    setActiveAgentName(null);
    if (resetStudio) {
      onReset();
    }
    return nextThread.id;
  }

  async function saveMessage(params: {
    threadId: string;
    role: "user" | "assistant";
    text: string;
    agentName?: AgentName | null;
    title?: string | null;
  }) {
    const res = await fetch(`/api/studio-chat/threads/${params.threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: params.role,
        text: params.text,
        agentName: params.agentName ?? null,
        title: params.title ?? null,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error ?? "메시지를 저장하지 못했습니다.");
    }
    return payload.message as StoredMessage;
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoadingThreads(true);
      const savedThreadId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STUDIO_THREAD_STORAGE_KEY)
          : null;
      const nextThreads = await loadThreads(savedThreadId);
      if (cancelled) return;
      setLoadingThreads(false);
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [storageUnavailable]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedThreadId) {
      window.localStorage.setItem(STUDIO_THREAD_STORAGE_KEY, selectedThreadId);
    } else {
      window.localStorage.removeItem(STUDIO_THREAD_STORAGE_KEY);
    }
  }, [selectedThreadId]);

  useEffect(() => {
    const syncViewport = () => setViewportWidth(window.innerWidth);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STUDIO_THREAD_PANEL_COLLAPSED_KEY);
    setIsThreadPanelCollapsed(saved === "true");
  }, []);

  useEffect(() => {
    if (isMobileViewport) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STUDIO_THREAD_PANEL_COLLAPSED_KEY,
      isThreadPanelCollapsed ? "true" : "false"
    );
  }, [isMobileViewport, isThreadPanelCollapsed]);

  useEffect(() => {
    if (isMobileViewport) {
      setIsThreadPanelCollapsed(true);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!selectedThreadId || storageUnavailable) return;
    void loadMessages(selectedThreadId);
  }, [selectedThreadId, storageUnavailable]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingText]);

  useEffect(() => {
    agentStates.forEach((status, agent) => {
      const prev = prevStates.current.get(agent);
      if (prev !== status && status !== "pending") {
        const meta = AGENT_META[agent];
        const desc =
          status === "done"
            ? `${meta.label} — 완료`
            : status === "running"
              ? `${meta.label} 실행 중...`
              : status === "skipped"
                ? `${meta.label} — 건너뜀`
                : status === "error"
                  ? `${meta.label} — 오류 발생`
                  : "";
        setEphemeralMessages((prevItems) => [
          ...prevItems,
          { type: "event", agent, status, desc },
        ]);
      }
    });
    prevStates.current = new Map(agentStates);
  }, [agentStates]);

  useEffect(() => {
    if (lessonPackage && prevRunning.current) {
      setEphemeralMessages((prevItems) => [
        ...prevItems,
        {
          type: "ai",
          text: "레슨 패키지가 완성되었습니다! 우측 미리보기에서 확인하고 PDF/DOCX로 내보낼 수 있습니다. 🎉",
          ts: new Date(),
        },
        { type: "result", pkg: lessonPackage },
      ]);
    }
    prevRunning.current = isRunning;
  }, [lessonPackage, isRunning]);

  useEffect(() => {
    if (error) {
      setEphemeralMessages((prevItems) => [...prevItems, { type: "error", text: error }]);
    }
  }, [error]);

  function adjustHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  const MENTION_AGENTS = CALLABLE_AGENT_ORDER.map((agent) => ({
    key: AGENT_META[agent].displayMention,
    agent,
    label: `@${AGENT_META[agent].displayMention}`,
    desc: AGENT_META[agent].label,
    num: AGENT_META[agent].num,
    tokens: getAgentMentionTokens(agent),
  }));

  const filteredMentions =
    mentionQuery !== null
      ? MENTION_AGENTS.filter(
          (mention) =>
            mention.tokens.some((token) => token.includes(mentionQuery)) ||
            mention.desc.includes(mentionQuery)
        )
      : [];

  function detectMention(val: string) {
    const atIdx = val.lastIndexOf("@");
    if (atIdx === -1) {
      setMentionQuery(null);
      return;
    }
    const after = val.slice(atIdx + 1);
    if (/\s/.test(after)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(after.trim().toLowerCase());
    setMentionIdx(0);
  }

  function selectMention(key: string, agent: AgentName) {
    const atIdx = input.lastIndexOf("@");
    setInput(input.slice(0, atIdx) + "@" + key + " ");
    setActiveAgentName(agent);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    adjustHeight();
    detectMention(e.target.value);
  }

  async function runAgentChatRequest(params: {
    agentName: AgentName;
    messages: ChatHistory;
    threadId: string | null;
    sessionTitle: string;
  }) {
    const res = await fetch("/api/agent-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: params.agentName,
          messages: params.messages,
          sessionId: params.threadId,
          sessionTitle: params.sessionTitle,
          levelProfile: selectedLevel,
          provider,
        }),
      });

    if (!res.ok || !res.body) {
      throw new Error("에이전트 응답을 불러오지 못했습니다.");
    }

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
          }
          if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (parseError) {
          if ((parseError as Error).message !== "Unexpected token") throw parseError;
        }
      }
    }

    return fullText;
  }

  async function appendAssistantMessage(params: {
    threadId: string;
    text: string;
    agentName: AgentName;
  }) {
    const createdAt = new Date().toISOString();
    const optimisticAssistantMessage = {
      id: `local-assistant-${Date.now()}-${params.agentName}`,
      role: "assistant" as const,
      text: params.text,
      agent_name: params.agentName,
      created_at: createdAt,
    };

    setStoredMessages((prev) => dedupeStoredMessages([...prev, optimisticAssistantMessage]));
    if (!storageUnavailable) {
      updateThreadMetaLocally(params.threadId, {
        updated_at: createdAt,
        lastMessagePreview: params.text,
        lastMessageAt: createdAt,
      });
    }

    if (storageUnavailable) {
      return;
    }

    const assistantMessage = await saveMessage({
      threadId: params.threadId,
      role: "assistant",
      text: params.text,
      agentName: params.agentName,
    });

    setStoredMessages((prev) =>
      dedupeStoredMessages(
        prev.map((message) =>
          message.id === optimisticAssistantMessage.id ? assistantMessage : message
        )
      )
    );
    updateThreadMetaLocally(params.threadId, {
      updated_at: assistantMessage.created_at,
      lastMessagePreview: assistantMessage.text,
      lastMessageAt: assistantMessage.created_at,
    });
  }

  async function appendVicePrincipalReport(
    threadId: string,
    sessionTitle: string,
    userInstruction: string,
    sourceAgent: AgentName,
    sourceResponse: string
  ) {
    const reportPrompt = [
      `사용자가 ${AGENT_META[sourceAgent].label}에게 직접 업무를 지시했습니다.`,
      `원래 사용자 지시: ${userInstruction}`,
      `${AGENT_META[sourceAgent].label} 응답:`,
      sourceResponse,
      "",
      "위 작업 결과를 부원장 에이전트 입장에서 1차 검수/요약해서 사용자에게 다시 보고하세요. 최종 권한은 사용자에게 있다고 분명히 밝히고, 필요하면 다음 조치를 1~2개 제안하세요.",
    ].join("\n");

    const fullText = await runAgentChatRequest({
      agentName: AgentName.VICE_PRINCIPAL,
      messages: [{ role: "user", content: reportPrompt }],
      threadId: storageUnavailable ? null : threadId,
      sessionTitle,
    });

    await appendAssistantMessage({
      threadId,
      text: fullText,
      agentName: AgentName.VICE_PRINCIPAL,
    });
  }

  async function handleDeleteThread(threadId: string) {
    if (storageUnavailable) {
      if (!window.confirm("현재 임시 대화 내용을 비울까요? 저장된 학습자료는 삭제되지 않습니다.")) {
        return;
      }
      setStoredMessages([]);
      setEphemeralMessages([]);
      setShowConfirmButton(false);
      onReset();
      return;
    }
    if (!window.confirm("이 대화만 삭제할까요? 저장된 학습자료는 삭제되지 않습니다.")) {
      return;
    }

    const res = await fetch(`/api/studio-chat/threads/${threadId}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setThreadError(payload.error ?? "대화를 삭제하지 못했습니다.");
      return;
    }

    const remaining = threads.filter((thread) => thread.id !== threadId);
    setThreads(remaining);

    if (selectedThreadId === threadId) {
      if (remaining[0]?.id) {
        setSelectedThreadId(remaining[0].id);
      } else {
        await createThread();
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || isAiThinking || isRunning || sendLockRef.current || isComposingRef.current) return;

    const dedupeSignature = `${selectedThreadId ?? "new"}:${activeAgentName ?? "chat"}:${text}`;
    const now = Date.now();
    if (
      lastSendRef.current &&
      lastSendRef.current.signature === dedupeSignature &&
      now - lastSendRef.current.at < 1500
    ) {
      return;
    }
    lastSendRef.current = { signature: dedupeSignature, at: now };
    sendLockRef.current = true;

    let threadId = selectedThreadId;
    if (!threadId) {
      threadId = await createThread();
      if (!threadId) {
        sendLockRef.current = false;
        return;
      }
    }

    suppressNextCompositionEndRef.current = true;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    setMentionQuery(null);
    setShowConfirmButton(false);
    setConfirmMode("generate");

    const mentionMatch = text.match(/@([^\s]+)/);
    let targetAgent: AgentName | null = activeAgentName;
    if (mentionMatch) {
      const found = resolveAgentMention(mentionMatch[1]);
      if (found) targetAgent = found;
    }

    const titleSource =
      storedMessages.find((message) => message.role === "user")?.text ?? text;
    const nextTitle = titleSource.slice(0, 80);

    try {
      const optimisticUserMessage = {
        id: `local-user-${Date.now()}`,
        role: "user" as const,
        text,
        agent_name: null,
        created_at: new Date().toISOString(),
      };
      setStoredMessages((prev) => dedupeStoredMessages([...prev, optimisticUserMessage]));
      if (!storageUnavailable) {
        updateThreadMetaLocally(threadId, {
          title: selectedThread?.messageCount ? selectedThread?.title ?? "새 프로젝트" : nextTitle,
          updated_at: optimisticUserMessage.created_at,
          messageCount: (selectedThread?.messageCount ?? 0) + 1,
          lastMessagePreview: text,
          lastMessageAt: optimisticUserMessage.created_at,
        });
      }

      const userMessage = storageUnavailable
        ? optimisticUserMessage
        : await saveMessage({
            threadId,
            role: "user",
            text,
            title: selectedThread?.messageCount ? null : nextTitle,
          });
      if (!storageUnavailable) {
        setStoredMessages((prev) =>
          prev.map((message) => (message.id === optimisticUserMessage.id ? userMessage : message))
        );
      }
      const nextStoredMessages = dedupeStoredMessages([...storedMessages, userMessage]);

      const normalizedText = text.toLowerCase();
      const shouldReportToVicePrincipal =
        targetAgent !== null &&
        targetAgent !== AgentName.VICE_PRINCIPAL &&
        /(부원장|@vice_principal|vice principal)/i.test(text) &&
        /(보고|브리핑|정리|공유)/i.test(text);
      const retryRequestedByUser =
        !!failedAgentName &&
        retryIntentPattern.test(normalizedText) &&
        (targetAgent === failedAgentName ||
          (!targetAgent && retryContextPattern.test(normalizedText)));

      if (retryRequestedByUser) {
        onRetryFailedGenerate(
          buildRetrySummary(toChatHistory(nextStoredMessages), text),
          failedAgentName
        );
        setShowConfirmButton(false);
        setConfirmMode("generate");
        return;
      }

      setIsAiThinking(true);
      setStreamingText("");

      const endpoint = targetAgent ? "/api/agent-chat" : "/api/chat";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          targetAgent
            ? {
                agentName: targetAgent,
                messages: toChatHistory(nextStoredMessages),
                sessionId: storageUnavailable ? null : threadId,
                sessionTitle: nextTitle,
                levelProfile: selectedLevel,
                provider,
              }
            : {
                messages: toChatHistory(nextStoredMessages),
                sessionId: storageUnavailable ? null : threadId,
                sessionTitle: nextTitle,
                levelProfile: selectedLevel,
                provider,
              }
        ),
      });

      if (!res.ok || !res.body) {
        throw new Error("Chat request failed");
      }

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
          } catch (parseError) {
            if ((parseError as Error).message !== "Unexpected token") throw parseError;
          }
        }
      }

      const optimisticAssistantMessage = {
        id: `local-assistant-${Date.now()}`,
        role: "assistant" as const,
        text: fullText,
        agent_name: targetAgent ?? AgentName.VICE_PRINCIPAL,
        created_at: new Date().toISOString(),
      };
      setStoredMessages((prev) => dedupeStoredMessages([...prev, optimisticAssistantMessage]));
      if (!storageUnavailable) {
        updateThreadMetaLocally(threadId, {
          updated_at: optimisticAssistantMessage.created_at,
          messageCount: (selectedThread?.messageCount ?? 0) + 2,
          lastMessagePreview: fullText,
          lastMessageAt: optimisticAssistantMessage.created_at,
        });
      }
      const assistantMessage = storageUnavailable
        ? optimisticAssistantMessage
        : await saveMessage({
            threadId,
            role: "assistant",
            text: fullText,
            agentName: targetAgent ?? AgentName.VICE_PRINCIPAL,
          });
      if (!storageUnavailable) {
        setStoredMessages((prev) =>
          dedupeStoredMessages(
            prev.map((message) =>
              message.id === optimisticAssistantMessage.id ? assistantMessage : message
            )
          )
        );
      }
      setStreamingText("");

      if (!targetAgent && fullText.includes("레슨 생성을 시작하세요")) {
        setConfirmMode(failedAgentName ? "retry" : "generate");
        setShowConfirmButton(true);
      }

      if (shouldReportToVicePrincipal && targetAgent) {
        await appendVicePrincipalReport(threadId, nextTitle, text, targetAgent, fullText);
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : "오류가 발생했습니다.";
      setEphemeralMessages((prevItems) => [...prevItems, { type: "error", text: message }]);
      setStreamingText("");
    } finally {
      setIsAiThinking(false);
      sendLockRef.current = false;
      suppressNextCompositionEndRef.current = false;
    }
  }

  useEffect(() => {
    if (!failedAgentName || !error) return;
    const nextFailedAgent = failedAgentName;
    const signature = `${nextFailedAgent}:${error}`;
    if (lastFailureReportRef.current === signature) return;
    lastFailureReportRef.current = signature;

    let cancelled = false;

    async function reportFailureToVicePrincipal() {
      const threadId = selectedThreadId ?? (await createThread());
      if (!threadId || cancelled) return;

      try {
        const failurePrompt = [
          `${AGENT_META[nextFailedAgent].label} 단계에서 실패가 발생했습니다.`,
          `실패 메시지: ${error}`,
          levelContextText ? `현재 기본 레벨 설정: ${levelContextText}` : "",
          "",
          "부원장 에이전트로서 사용자에게 현재 상태, 실패 원인, 가장 안전한 수정안 1~3개를 설명하세요. 최종 재시도 여부는 사용자 승인 후 진행된다고 분명히 말하세요.",
        ]
          .filter(Boolean)
          .join("\n");

        const fullText = await runAgentChatRequest({
          agentName: AgentName.VICE_PRINCIPAL,
          messages: [{ role: "user", content: failurePrompt }],
          threadId: storageUnavailable ? null : threadId,
          sessionTitle: selectedThread?.title ?? "새 프로젝트",
        });

        if (!cancelled) {
          await appendAssistantMessage({
            threadId,
            text: fullText,
            agentName: AgentName.VICE_PRINCIPAL,
          });
        }
      } catch {
        // Secondary reporting should never break the main failure surface.
      }
    }

    void reportFailureToVicePrincipal();

    return () => {
      cancelled = true;
    };
  }, [error, failedAgentName, levelContextText, selectedThread?.title, selectedThreadId, storageUnavailable]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (e.repeat) {
      return;
    }
    if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
      return;
    }
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(filteredMentions[mentionIdx].key, filteredMentions[mentionIdx].agent);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function handleConfirm() {
    setShowConfirmButton(false);
    const transcript = chatHistory
      .map((message) => `${message.role === "user" ? "교사" : "AI"}: ${message.content}`)
      .join("\n");
    const summary = transcript
      ? `다음은 레슨 생성 전 대화 기록입니다. 사용자의 난이도/렉사일/어휘/문장 수준 조정 요청이 있으면 반드시 반영하세요.\n\n${transcript}`
      : "";
    if (confirmMode === "retry" && failedAgentName) {
      onRetryFailedGenerate(summary, failedAgentName);
    } else {
      onConfirmGenerate(summary);
    }
    setConfirmMode("generate");
  }

  function handleReset() {
    setEphemeralMessages([]);
    setShowConfirmButton(false);
    setConfirmMode("generate");
    onReset();
  }

  const isEmpty = displayMessages.length === 0 && !streamingText;
  const isBusy = isAiThinking || isRunning;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "var(--color-bg)", position: "relative" }}>
      {isMobileViewport && isThreadPanelCollapsed && (
        <button
          type="button"
          onClick={() => setIsThreadPanelCollapsed(false)}
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            zIndex: 15,
            padding: "8px 10px",
            borderRadius: "10px",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: "12px",
            fontWeight: "700",
            boxShadow: "0 8px 18px rgba(15,23,42,0.12)",
          }}
        >
          프로젝트
        </button>
      )}
      <aside
        style={{
          width: isMobileViewport
            ? (isThreadPanelCollapsed ? "0px" : "280px")
            : (isThreadPanelCollapsed ? "52px" : "280px"),
          borderRight: isThreadPanelCollapsed && isMobileViewport ? "none" : "1px solid var(--color-border)",
          background: "var(--color-surface)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          transition: "width .18s ease",
          overflow: "hidden",
          position: isMobileViewport ? "absolute" : "relative",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: isMobileViewport ? 20 : "auto",
          boxShadow: isMobileViewport && !isThreadPanelCollapsed ? "0 14px 32px rgba(15,23,42,0.16)" : "none",
        }}
      >
        <div
          style={{
            padding: isThreadPanelCollapsed ? "12px 8px" : "12px 14px 8px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            justifyContent: isThreadPanelCollapsed ? "center" : "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {!isThreadPanelCollapsed ? (
            <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>
              프로젝트
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setIsThreadPanelCollapsed((prev) => !prev)}
            title={isThreadPanelCollapsed ? "프로젝트 창 펼치기" : "프로젝트 창 숨기기"}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {isThreadPanelCollapsed ? (
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>

        {isThreadPanelCollapsed ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 8px",
            }}
          >
            <button
              onClick={() => void createThread(true)}
              title="새 프로젝트"
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                border: "1px solid var(--color-border-strong)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                fontSize: "18px",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              +
            </button>
            <div
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontSize: "11px",
                color: "var(--color-text-subtle)",
                letterSpacing: "1px",
              }}
            >
              프로젝트
            </div>
          </div>
        ) : (
          <>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
          <button
            onClick={() => void createThread(true)}
            style={{
              width: "100%",
              borderRadius: "10px",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              padding: "10px 12px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            + 새 프로젝트
          </button>
          <p style={{ marginTop: "8px", fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: "1.5" }}>
            {storageUnavailable
              ? "지금은 임시 대화 모드입니다. 화면을 이동하면 대화가 사라집니다."
              : "대화만 따로 저장됩니다. 삭제해도 저장된 학습자료는 유지됩니다."}
          </p>
        </div>

        {storageUnavailable && threadError && (
          <div
            style={{
              margin: "10px 12px 0",
              padding: "10px 12px",
              borderRadius: "10px",
              background: "#EFF6FF",
              border: "1px solid #BFDBFE",
              color: "#1D4ED8",
              fontSize: "12px",
              lineHeight: 1.6,
            }}
          >
            {threadError}
          </div>
        )}

        {!storageUnavailable && threadError && (
          <div
            style={{
              margin: "10px 12px 0",
              padding: "9px 10px",
              borderRadius: "8px",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#B91C1C",
              fontSize: "12px",
            }}
          >
            {threadError}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px 14px" }}>
          {loadingThreads ? (
            <div style={{ padding: "16px 10px", fontSize: "12px", color: "var(--color-text-subtle)" }}>
              대화 목록을 불러오는 중...
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: "16px 10px", fontSize: "12px", color: "var(--color-text-subtle)" }}>
              아직 저장된 대화가 없습니다.
            </div>
          ) : (
            threads.map((thread) => {
              const selected = thread.id === selectedThreadId;
              return (
                <button
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 12px",
                    borderRadius: "12px",
                    border: selected
                      ? "1px solid var(--color-primary)"
                      : "1px solid transparent",
                    background: selected ? "var(--color-primary-light)" : "transparent",
                    cursor: "pointer",
                    marginBottom: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "start", gap: "8px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "700",
                          color: "var(--color-text)",
                          lineHeight: "1.4",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {thread.title}
                      </div>
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                          lineHeight: "1.4",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {thread.lastMessagePreview ?? "아직 대화가 없습니다."}
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          fontSize: "10px",
                          color: "var(--color-text-subtle)",
                        }}
                      >
                        <span>{formatThreadTime(thread.lastMessageAt ?? thread.updated_at)}</span>
                        <span>{thread.messageCount}개</span>
                      </div>
                    </div>
                    <div
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteThread(thread.id);
                      }}
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#B91C1C",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 3.5h7M4.5 1.8h3M4 4.5v4M6 4.5v4M8 4.5v4M3.5 3.5l.4 5.4c.03.4.37.7.77.7h2.66c.4 0 .74-.3.77-.7l.4-5.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
          </>
        )}
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              alignSelf: "center",
              fontSize: "12px",
              color: approvalMode === "require_review" ? "#B45309" : "var(--color-text-subtle)",
              background: approvalMode === "require_review" ? "#FEF3C7" : "var(--color-surface)",
              border: `1px solid ${approvalMode === "require_review" ? "#FCD34D" : "var(--color-border)"}`,
              borderRadius: "999px",
              padding: "6px 10px",
            }}
          >
            {approvalMode === "require_review"
              ? "현재 모드: 최종 발행 전 관리자 승인 필요"
              : "현재 모드: 승인 없이 바로 발행"}
          </div>

          {loadingMessages ? (
            <div style={{ paddingTop: "40px", textAlign: "center", fontSize: "13px", color: "var(--color-text-subtle)" }}>
              대화 내용을 불러오는 중...
            </div>
          ) : isEmpty ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", paddingTop: "60px" }}>
              <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "var(--color-primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
                💬
              </div>
              <div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", textAlign: "center" }}>
                  어떤 레슨을 만들어 드릴까요?
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-muted)", textAlign: "center", marginTop: "6px", lineHeight: "1.6" }}>
                  학년, 주제, 난이도를 알려주시면 함께 레슨을 기획해 드립니다.
                  <br />
                  준비가 되면 대화를 이어가고, 필요 없어진 대화는 왼쪽 목록에서 삭제할 수 있습니다.
                </div>
                {levelContextText && (
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--color-primary)", textAlign: "center", fontWeight: "600" }}>
                    기본 레벨 적용: {levelContextText}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center", maxWidth: "420px" }}>
                {QUICK.map((quick) => (
                  <button
                    key={quick.text}
                    onClick={() => {
                      setInput(quick.text);
                      textareaRef.current?.focus();
                    }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "20px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text-muted)",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    {quick.icon} {quick.text.length > 24 ? `${quick.text.slice(0, 24)}…` : quick.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map((msg, i) => {
                if (msg.type === "user") {
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "flex-end" }}>
                      <div>
                        <div
                          style={{
                            background: "var(--color-primary)",
                            color: "#fff",
                            padding: "10px 14px",
                            borderRadius: "12px 4px 12px 12px",
                            fontSize: "13px",
                            lineHeight: "1.6",
                            maxWidth: isMobileViewport ? "100%" : "420px",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {msg.text}
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", textAlign: "right", marginTop: "3px" }}>
                          {fmt(msg.ts)}
                        </div>
                      </div>
                      <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary)", color: "#fff", fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        T
                      </div>
                    </div>
                  );
                }

                if (msg.type === "ai") {
                  const agentMeta = msg.agentName ? AGENT_META[msg.agentName] : null;
                  return (
                    <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: agentMeta ? "#1E293B" : "var(--color-primary-light)",
                          color: agentMeta ? "#fff" : "var(--color-primary)",
                          fontSize: "9px",
                          fontWeight: "700",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          marginTop: "2px",
                        }}
                      >
                        {agentMeta ? agentMeta.num : "AI"}
                      </div>
                      <div>
                        {agentMeta && (
                          <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginBottom: "3px", fontWeight: "600" }}>
                            {agentMeta.label}
                          </div>
                        )}
                        <div
                          style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                            padding: "10px 14px",
                            borderRadius: "4px 12px 12px 12px",
                            fontSize: "13px",
                            lineHeight: "1.6",
                            maxWidth: isMobileViewport ? "100%" : "440px",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {msg.text}
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "3px" }}>
                          {fmt(msg.ts)}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (msg.type === "event") {
                  const color = EVT_COLOR[msg.status] ?? EVT_COLOR.running;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        background: color.bg,
                        border: `1px solid ${color.border}`,
                        borderRadius: "8px",
                        padding: "8px 12px",
                      }}
                    >
                      <span style={{ fontSize: "14px", flexShrink: 0 }}>{EVT_ICON[msg.status] ?? "•"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "12px", fontWeight: "600", color: color.text }}>{msg.desc}</div>
                        <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "1px" }}>
                          {AGENT_META[msg.agent].num} / {AGENT_META[msg.agent].mention}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (msg.type === "error") {
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        fontSize: "13px",
                        color: "#DC2626",
                        lineHeight: "1.5",
                      }}
                    >
                      ❌ {msg.text}
                    </div>
                  );
                }

                if (msg.type === "result") {
                  return (
                    <div
                      key={i}
                      style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "10px",
                        padding: "12px 14px",
                      }}
                    >
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
                          <span key={label} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: "#EEF2FF", color }}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }

                return null;
              })}

              {streamingText && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
                    AI
                  </div>
                  <div
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      padding: "10px 14px",
                      borderRadius: "4px 12px 12px 12px",
                      fontSize: "13px",
                      lineHeight: "1.6",
                      maxWidth: isMobileViewport ? "100%" : "440px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {streamingText}
                    <span
                      style={{
                        display: "inline-block",
                        width: "2px",
                        height: "14px",
                        background: "var(--color-primary)",
                        marginLeft: "2px",
                        animation: "blink 1s step-end infinite",
                        verticalAlign: "middle",
                      }}
                    />
                  </div>
                </div>
              )}

              {isAiThinking && !streamingText && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--color-primary-light)", color: "var(--color-primary)", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    AI
                  </div>
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

        {showConfirmButton && !isRunning && (
          <div
            style={{
              padding: "10px 16px",
              background: "linear-gradient(135deg, #EFF6FF, #F0FDF4)",
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div style={{ flex: 1, fontSize: "12px", color: "var(--color-text-muted)", lineHeight: "1.4" }}>
              {confirmMode === "retry" && failedAgentName
                ? `${AGENT_META[failedAgentName].label} 단계 실패 내용을 반영해 해당 단계부터 다시 진행합니다.`
                : "레슨 정보가 확인되었습니다. 아래 버튼을 눌러 생성을 시작하세요."}
            </div>
            <button
              onClick={handleConfirm}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: "700",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 8px rgba(79,70,229,.35)",
                flexShrink: 0,
              }}
            >
              🚀 {confirmMode === "retry" && failedAgentName ? "실패 단계 재시도" : "레슨 생성 시작"}
            </button>
          </div>
        )}

        <div style={{ padding: "10px 16px 12px", background: "var(--color-surface)", borderTop: "1px solid var(--color-border)" }}>
          {activeAgentName && (
            <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>대화 중:</span>
              <span style={{ fontSize: "11px", fontWeight: "600", padding: "2px 8px", borderRadius: "4px", background: "#1E293B", color: "#fff" }}>
                {AGENT_META[activeAgentName].num} {AGENT_META[activeAgentName].label}
              </span>
              <button
                onClick={() => {
                  setActiveAgentName(null);
                }}
                style={{ fontSize: "10px", color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                종료
              </button>
            </div>
          )}

          <div style={{ position: "relative" }}>
            {mentionQuery !== null && filteredMentions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 4px)",
                  left: "0",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9px",
                  boxShadow: "0 4px 16px rgba(0,0,0,.12)",
                  overflow: "hidden",
                  zIndex: 50,
                  width: "280px",
                }}
              >
                <div style={{ padding: "7px 12px 5px", fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", borderBottom: "1px solid var(--color-border)", letterSpacing: ".4px", textTransform: "uppercase" }}>
                  에이전트 호출
                </div>
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {filteredMentions.slice(0, 10).map((mention, idx) => (
                    <div
                      key={mention.key}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectMention(mention.key, mention.agent);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "7px 12px",
                        cursor: "pointer",
                        background: idx === mentionIdx ? "var(--color-primary-light)" : "transparent",
                      }}
                      onMouseEnter={() => setMentionIdx(idx)}
                    >
                      <div
                        style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "5px",
                          background: "var(--color-bg)",
                          border: "1px solid var(--color-border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "9px",
                          fontWeight: "700",
                          color: "var(--color-primary)",
                          flexShrink: 0,
                        }}
                      >
                        {mention.num}
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text)" }}>{mention.label}</div>
                        <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>{mention.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "8px",
                background: "var(--color-bg)",
                border: "1.5px solid var(--color-border-strong)",
                borderRadius: "10px",
                padding: "8px 10px",
              }}
              onFocusCapture={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-primary)";
              }}
              onBlurCapture={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)";
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false;
                  if (suppressNextCompositionEndRef.current) {
                    suppressNextCompositionEndRef.current = false;
                    e.currentTarget.value = "";
                    setInput("");
                    adjustHeight();
                    setMentionQuery(null);
                    return;
                  }
                  setInput(e.currentTarget.value);
                  adjustHeight();
                  detectMention(e.currentTarget.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder={isBusy ? "잠시 기다려 주세요..." : "메시지 입력 — @ 로 특정 에이전트 호출"}
                rows={1}
                disabled={isBusy || !selectedThreadId}
                style={{
                  flex: 1,
                  resize: "none",
                  border: "none",
                  background: "transparent",
                  fontSize: "13px",
                  color: "var(--color-text)",
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: "1.5",
                  minHeight: "20px",
                  maxHeight: "120px",
                }}
              />
              <button
                onClick={() => void send()}
                disabled={!input.trim() || isBusy || !selectedThreadId}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "7px",
                  background: !input.trim() || isBusy || !selectedThreadId ? "var(--color-border-strong)" : "var(--color-primary)",
                  color: !input.trim() || isBusy || !selectedThreadId ? "var(--color-text-subtle)" : "#fff",
                  border: "none",
                  cursor: !input.trim() || isBusy || !selectedThreadId ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M1 12L6.5 1 12 12M3 9h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "6px", paddingLeft: "2px" }}>
            @ 로 에이전트 호출 · 대화는 자동 저장됩니다 · 삭제해도 학습자료는 유지됩니다
          </div>

          <div style={{ marginTop: "6px", display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={handleReset}
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
              }}
            >
              현재 화면 초기화
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>
    </div>
  );
}
