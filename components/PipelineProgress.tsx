"use client";

import { AgentName, AgentStatus } from "@/lib/agents/types";
import { AgentProgressState } from "@/hooks/useLessonGenerate";

interface PipelineProgressProps {
  pipelineOrder: AgentName[];
  agentStates: Map<AgentName, AgentProgressState>;
}

const AGENT_LABELS: Record<AgentName, string> = {
  [AgentName.VICE_PRINCIPAL]: "부원장 총괄",
  [AgentName.INTENT_ROUTER]: "요청 분류",
  [AgentName.TEACHING_FRAME]: "교수 프레임 설정",
  [AgentName.DIFFICULTY_LOCK]: "난이도 잠금",
  [AgentName.SOURCE_MODE_ROUTER]: "소스 경로 결정",
  [AgentName.TOPIC_SELECTION]: "주제 선정",
  [AgentName.RESEARCH_CURATION]: "리서치",
  [AgentName.PASSAGE_GENERATION]: "지문 생성",
  [AgentName.PASSAGE_VALIDATION]: "지문 검증",
  [AgentName.APPROVED_PASSAGE_LOCK]: "지문 잠금",
  [AgentName.READING]: "독해 문제",
  [AgentName.VOCABULARY]: "어휘 학습",
  [AgentName.GRAMMAR]: "문법 문제",
  [AgentName.WRITING]: "쓰기 과제",
  [AgentName.ASSESSMENT]: "평가지",
  [AgentName.QA]: "QA 검수",
  [AgentName.PUBLISHER]: "최종 발행",
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { icon: string; className: string; label: string }
> = {
  pending:  { icon: "○", className: "text-gray-300",  label: "대기" },
  running:  { icon: "●", className: "text-blue-500 animate-pulse", label: "실행 중" },
  done:     { icon: "✓", className: "text-green-500", label: "완료" },
  skipped:  { icon: "–", className: "text-gray-400",  label: "건너뜀" },
  error:    { icon: "✗", className: "text-red-500",   label: "오류" },
};

export function PipelineProgress({ pipelineOrder, agentStates }: PipelineProgressProps) {
  const doneCount = Array.from(agentStates.values()).filter(
    (s) => s.status === "done" || s.status === "skipped"
  ).length;
  const total = pipelineOrder.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{doneCount} / {total} 에이전트</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Agent list */}
      <div className="space-y-1">
        {pipelineOrder.map((agentName, i) => {
          const state = agentStates.get(agentName) ?? {
            agent: agentName,
            status: "pending" as AgentStatus,
          };
          const cfg = STATUS_CONFIG[state.status];
          return (
            <div
              key={agentName}
              className={`flex items-center gap-2 text-sm py-0.5 ${
                state.status === "pending" ? "opacity-40" : ""
              }`}
            >
              <span className="w-5 text-right text-xs text-gray-400 shrink-0">
                {i + 1}
              </span>
              <span className={`w-4 text-center shrink-0 ${cfg.className}`}>
                {cfg.icon}
              </span>
              <span
                className={
                  state.status === "running"
                    ? "font-medium text-blue-700"
                    : state.status === "error"
                    ? "text-red-600"
                    : state.status === "done"
                    ? "text-gray-700"
                    : "text-gray-400"
                }
              >
                {AGENT_LABELS[agentName]}
              </span>
              {state.status === "running" && (
                <span className="text-xs text-blue-400 animate-pulse">처리 중...</span>
              )}
              {state.status === "error" && state.error && (
                <span className="text-xs text-red-400 truncate max-w-[180px]" title={state.error}>
                  {state.error}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
