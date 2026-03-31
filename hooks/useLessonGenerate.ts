"use client";

import { useState, useCallback, useRef } from "react";
import { AgentName, AIProvider, DifficultyLevel, LessonPackage, AgentStatus } from "@/lib/agents/types";

export interface AgentProgressState {
  agent: AgentName;
  status: AgentStatus;
  error?: string;
}

export interface GenerateState {
  isRunning: boolean;
  agentStates: Map<AgentName, AgentProgressState>;
  lessonPackage: LessonPackage | null;
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
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (params: {
      userInput: string;
      provider: AIProvider;
      difficulty?: DifficultyLevel;
      providedPassage?: string;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        isRunning: true,
        agentStates: initialAgentStates(),
        lessonPackage: null,
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
          throw new Error(text || "Request failed");
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
              const { agent, status, error } = event as {
                agent: AgentName;
                status: AgentStatus;
                error?: string;
              };
              setState((prev) => {
                const next = new Map(prev.agentStates);
                next.set(agent, { agent, status, error });
                return { ...prev, agentStates: next };
              });
            } else if (event.type === "complete") {
              setState((prev) => ({
                ...prev,
                isRunning: false,
                lessonPackage: event.package as LessonPackage,
              }));
            } else if (event.type === "error") {
              setState((prev) => ({
                ...prev,
                isRunning: false,
                error: event.error as string,
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
      error: null,
    });
  }, []);

  return { ...state, pipelineOrder: PIPELINE_ORDER, generate, reset };
}
