"use client";

import { useState, useCallback, useRef } from "react";
import { AgentName, AIProvider, ContentCounts, DifficultyLevel, LessonPackage, AgentStatus } from "@/lib/agents/types";
import { AgentName as LessonAgentName, ContentCheckpoint, PassageCheckpoint } from "@/lib/workflows/lesson/types";

export interface AgentProgressState {
  agent: AgentName;
  status: AgentStatus;
  output?: unknown;
  error?: string;
}

export interface GenerateState {
  isRunning: boolean;
  agentStates: Map<AgentName, AgentProgressState>;
  lessonPackage: LessonPackage | null;
  passageCheckpoint: PassageCheckpoint | null;
  contentCheckpoint: ContentCheckpoint | null;
  error: string | null;
}

const PIPELINE_ORDER: AgentName[] = [
  AgentName.INTENT_ROUTER,
  AgentName.TEACHING_FRAME,
  AgentName.DIFFICULTY_LOCK,
  AgentName.SOURCE_MODE_ROUTER,
  AgentName.TOPIC_SELECTION,
  AgentName.RESEARCH_CURATION,
  AgentName.PASSAGE_GENERATION,
  AgentName.PASSAGE_VALIDATION,
  AgentName.APPROVED_PASSAGE_LOCK,
  AgentName.READING,
  AgentName.VOCABULARY,
  AgentName.GRAMMAR,
  AgentName.WRITING,
  AgentName.ASSESSMENT,
  AgentName.QA,
  AgentName.PUBLISHER,
];

const initialAgentStates = (): Map<AgentName, AgentProgressState> => {
  const map = new Map<AgentName, AgentProgressState>();
  for (const agent of PIPELINE_ORDER) {
    map.set(agent, { agent, status: "pending" });
  }
  return map;
};

export function useLessonGenerate() {
  const [state, setState] = useState<GenerateState>({
    isRunning: false,
    agentStates: initialAgentStates(),
    lessonPackage: null,
    passageCheckpoint: null,
    contentCheckpoint: null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (params: {
      userInput: string;
      provider: AIProvider;
      difficulty?: DifficultyLevel;
      providedPassage?: string;
      approvalMode?: "auto" | "require_review";
      contentCounts?: ContentCounts;
      generationTarget?: "full" | "passage_review" | "content_review" | "passage_and_content_review";
      passageCheckpoint?: PassageCheckpoint;
      contentCheckpoint?: ContentCheckpoint;
      regenerateAgents?: LessonAgentName[];
      revisionInstructions?: Partial<Record<LessonAgentName, string>>;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        isRunning: true,
        agentStates: initialAgentStates(),
        lessonPackage: null,
        passageCheckpoint: null,
        contentCheckpoint: null,
        error: null,
      });

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let message = text || "Request failed";
          try {
            const json = JSON.parse(text);
            if (json?.error?.type === "overloaded_error") {
              message = "Claude API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.";
            } else if (json?.error?.message) {
              message = json.error.message;
            }
          } catch {}
          throw new Error(message);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event.type === "progress") {
              const { agent, status, error, output } = event as {
                agent: AgentName;
                status: AgentStatus;
                output?: unknown;
                error?: string;
              };
              setState((prev) => {
                const next = new Map(prev.agentStates);
                next.set(agent, { agent, status, output, error });
                return { ...prev, agentStates: next };
              });
            } else if (event.type === "complete") {
              setState((prev) => ({
                ...prev,
                isRunning: false,
                lessonPackage: event.package as LessonPackage,
                passageCheckpoint: null,
                contentCheckpoint: null,
              }));
            } else if (event.type === "passage_review") {
              setState((prev) => ({
                ...prev,
                isRunning: false,
                lessonPackage: null,
                passageCheckpoint: (event.checkpoint as PassageCheckpoint) ?? null,
                contentCheckpoint: null,
              }));
            } else if (event.type === "content_review") {
              setState((prev) => ({
                ...prev,
                isRunning: false,
                lessonPackage: null,
                passageCheckpoint: null,
                contentCheckpoint: (event.checkpoint as ContentCheckpoint) ?? null,
              }));
            } else if (event.type === "approval_required") {
              const summary =
                typeof event.summary === "string"
                  ? event.summary
                  : "승인 대기 중입니다. 운영 센터에서 검토해 주세요.";
              setState((prev) => ({
                ...prev,
                isRunning: false,
                error: `승인 필요: ${summary}`,
              }));
            } else if (event.type === "error") {
              let errorMsg = event.error as string;
              if (errorMsg?.includes("overloaded_error") || errorMsg?.includes("Overloaded")) {
                errorMsg = "Claude API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.";
              }
              setState((prev) => ({
                ...prev,
                isRunning: false,
                error: errorMsg,
              }));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          isRunning: false,
          error: err instanceof Error ? err.message : "Unknown error",
        }));
      }
    },
    []
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      isRunning: false,
      agentStates: initialAgentStates(),
      lessonPackage: null,
      passageCheckpoint: null,
      contentCheckpoint: null,
      error: null,
    });
  }, []);

  return { ...state, pipelineOrder: PIPELINE_ORDER, generate, reset };
}
