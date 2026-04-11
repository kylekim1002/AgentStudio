"use client";

import { useEffect, useMemo, useState } from "react";

type ExecutionStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

type ApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

interface WorkflowStepEvent {
  workflow: string;
  step: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  output?: unknown;
  error?: string;
  timestamp: string;
}

interface WorkflowExecution {
  id: string;
  workflow: string;
  status: ExecutionStatus;
  approvalStatus: ApprovalStatus;
  riskLevel: "safe" | "review" | "critical";
  input: Record<string, unknown> | null;
  result?: unknown;
  error?: string;
  currentStep?: string;
  checkpoint?: unknown;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  steps: WorkflowStepEvent[];
}

interface ApprovalRequest {
  id: string;
  workflow: string;
  executionId: string;
  step?: string;
  riskLevel: "safe" | "review" | "critical";
  title: string;
  summary: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  waiting_approval: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-700",
};

const RISK_STYLES: Record<ApprovalRequest["riskLevel"], string> = {
  safe: "bg-emerald-50 text-emerald-700 border-emerald-200",
  review: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
};

function formatDate(value?: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function summarizeInput(input: Record<string, unknown> | null): string {
  if (!input) return "입력 정보 없음";
  const userInput = typeof input.userInput === "string" ? input.userInput : null;
  if (userInput) return userInput;
  return JSON.stringify(input).slice(0, 120);
}

export default function OpsClient() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  async function loadData(mode: "initial" | "refresh" = "refresh") {
    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [executionRes, approvalRes] = await Promise.all([
        fetch("/api/workflows/executions"),
        fetch("/api/approvals?status=pending"),
      ]);

      const executionJson = await executionRes.json();
      const approvalJson = await approvalRes.json();

      setExecutions(executionJson.executions ?? []);
      setApprovals(approvalJson.approvals ?? []);
      setSelectedId((prev) =>
        prev && (executionJson.executions ?? []).some((item: WorkflowExecution) => item.id === prev)
          ? prev
          : executionJson.executions?.[0]?.id ?? null
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData("initial");
    const timer = window.setInterval(() => {
      void loadData();
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedExecution = useMemo(
    () => executions.find((item) => item.id === selectedId) ?? null,
    [executions, selectedId]
  );

  async function handleDecision(
    approvalId: string,
    decision: "approved" | "rejected"
  ) {
    setActionLoadingId(approvalId);
    try {
      const approvalRes = await fetch(`/api/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decidedBy: "admin-ui" }),
      });
      const approvalPayload = await approvalRes.json();

      if (decision === "approved" && approvalPayload?.approval?.executionId) {
        await fetch(
          `/api/workflows/executions/${approvalPayload.approval.executionId}/resume`,
          { method: "POST" }
        );
      }
      await loadData();
    } finally {
      setActionLoadingId(null);
    }
  }

  const summary = {
    total: executions.length,
    running: executions.filter((item) => item.status === "running").length,
    failed: executions.filter((item) => item.status === "failed").length,
    waitingApproval: executions.filter((item) => item.status === "waiting_approval").length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                운영 센터
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                워크플로우 실행 상태, 실패 원인, 승인 대기 항목을 한 화면에서 확인합니다.
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {refreshing ? "새로고침 중..." : "새로고침"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</div>
              <div className="mt-2 text-3xl font-semibold">{summary.total}</div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-blue-900">
              <div className="text-xs uppercase tracking-[0.18em] text-blue-500">Running</div>
              <div className="mt-2 text-3xl font-semibold">{summary.running}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900">
              <div className="text-xs uppercase tracking-[0.18em] text-amber-500">Approval</div>
              <div className="mt-2 text-3xl font-semibold">{summary.waitingApproval}</div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-rose-900">
              <div className="text-xs uppercase tracking-[0.18em] text-rose-500">Failed</div>
              <div className="mt-2 text-3xl font-semibold">{summary.failed}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">실행 이력</h2>
                <p className="text-sm text-slate-500">최근 워크플로우 실행 목록</p>
              </div>
            </div>

            {loading ? (
              <div className="px-5 py-12 text-sm text-slate-400">불러오는 중...</div>
            ) : executions.length === 0 ? (
              <div className="px-5 py-12 text-sm text-slate-400">실행 이력이 없습니다.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {executions.map((execution) => (
                  <button
                    key={execution.id}
                    onClick={() => setSelectedId(execution.id)}
                    className={`w-full px-5 py-4 text-left transition ${
                      execution.id === selectedId ? "bg-slate-50" : "hover:bg-slate-50/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {execution.workflow}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[execution.status]}`}
                          >
                            {execution.status}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {summarizeInput(execution.input)}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>{execution.id}</span>
                          <span>{formatDate(execution.updatedAt)}</span>
                          <span>{execution.currentStep ?? "step 없음"}</span>
                        </div>
                      </div>
                      <div
                        className={`rounded-full border px-2 py-1 text-xs font-medium ${RISK_STYLES[execution.riskLevel]}`}
                      >
                        {execution.riskLevel}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">승인 대기</h2>
              <p className="text-sm text-slate-500">위험도에 따라 승인 또는 거절할 수 있습니다.</p>
            </div>

            {approvals.length === 0 ? (
              <div className="px-5 py-10 text-sm text-slate-400">대기 중인 승인 요청이 없습니다.</div>
            ) : (
              <div className="space-y-4 px-5 py-5">
                {approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className={`rounded-2xl border p-4 ${RISK_STYLES[approval.riskLevel]}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                            {approval.riskLevel}
                          </span>
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                            {approval.workflow}
                          </span>
                        </div>
                        <h3 className="mt-2 text-sm font-semibold">{approval.title}</h3>
                        <p className="mt-1 text-sm opacity-90">{approval.summary}</p>
                        <div className="mt-2 text-xs opacity-70">
                          {approval.executionId} · {approval.step ?? "step 없음"} · {formatDate(approval.createdAt)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleDecision(approval.id, "approved")}
                          disabled={actionLoadingId === approval.id}
                          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => void handleDecision(approval.id, "rejected")}
                          disabled={actionLoadingId === approval.id}
                          className="rounded-lg border border-current px-3 py-2 text-xs font-semibold transition hover:bg-white/60 disabled:opacity-60"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">실행 상세</h2>
            <p className="text-sm text-slate-500">선택한 워크플로우의 진행 단계와 오류를 확인합니다.</p>
          </div>

          {!selectedExecution ? (
            <div className="px-5 py-12 text-sm text-slate-400">왼쪽에서 실행 항목을 선택하세요.</div>
          ) : (
            <div className="space-y-5 px-5 py-5">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                      {selectedExecution.workflow}
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">
                      {selectedExecution.id}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[selectedExecution.status]}`}
                  >
                    {selectedExecution.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-600">
                  <div>현재 단계: {selectedExecution.currentStep ?? "-"}</div>
                  <div>시작 시각: {formatDate(selectedExecution.startedAt)}</div>
                  <div>마지막 업데이트: {formatDate(selectedExecution.updatedAt)}</div>
                  <div>완료 시각: {formatDate(selectedExecution.completedAt)}</div>
                  <div>체크포인트: {selectedExecution.checkpoint ? "저장됨" : "없음"}</div>
                </div>
                {selectedExecution.error && (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                    {selectedExecution.error}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">입력 요약</h3>
                <pre className="mt-2 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {JSON.stringify(selectedExecution.input, null, 2)}
                </pre>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">단계 타임라인</h3>
                <div className="mt-3 space-y-3">
                  {selectedExecution.steps.length === 0 ? (
                    <div className="text-sm text-slate-400">아직 기록된 단계가 없습니다.</div>
                  ) : (
                    selectedExecution.steps.map((step, index) => (
                      <div
                        key={`${step.step}-${step.timestamp}-${index}`}
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{step.step}</div>
                            <div className="text-xs text-slate-400">{formatDate(step.timestamp)}</div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              step.status === "done"
                                ? "bg-emerald-100 text-emerald-700"
                                : step.status === "error"
                                  ? "bg-rose-100 text-rose-700"
                                  : step.status === "skipped"
                                    ? "bg-slate-100 text-slate-600"
                                    : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {step.status}
                          </span>
                        </div>
                        {step.error && (
                          <div className="mt-2 text-sm text-rose-600">{step.error}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
