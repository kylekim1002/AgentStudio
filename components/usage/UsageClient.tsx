"use client";

import { useEffect, useMemo, useState } from "react";

interface UsageItem {
  id: string;
  createdAt: string;
  provider: string;
  model: string | null;
  workflow: string | null;
  agent: string | null;
  endpoint: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface UsageGroup {
  id: string;
  title: string;
  latestAt: string;
  startedAt: string;
  workflow: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  itemCount: number;
  providers: string[];
  models: string[];
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  items: UsageItem[];
}

interface UsageSummary {
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  uniqueUsers: number;
  modelsUsed: number;
  sessions: number;
}

interface UsagePayload {
  range: {
    from: string;
    to: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalGroups: number;
    totalPages: number;
    pageSizeOptions: number[];
  };
  summary: UsageSummary;
  groups: UsageGroup[];
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function formatMoneyUsd(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value ?? 0);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}

function workflowLabel(value: string | null) {
  if (value === "lesson_generation") return "레슨 생성";
  if (value === "studio_chat") return "스튜디오 채팅";
  if (value === "agent_chat") return "에이전트 대화";
  return value ?? "기타";
}

function providerLabel(provider: string, model?: string | null) {
  if (model) return `${provider.toUpperCase()} · ${model}`;
  return provider.toUpperCase();
}

function compactAgentLabel(agent: string | null) {
  if (!agent) return "-";
  return agent.replace(/_agent$/i, "");
}

export default function UsageClient() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return formatDateInput(start);
  });
  const [to, setTo] = useState(() => formatDateInput(today));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData(mode: "initial" | "refresh" = "refresh") {
    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const res = await fetch(
        `/api/ops/ai-usage?from=${from}&to=${to}&page=${page}&pageSize=${pageSize}`,
        { cache: "no-store" }
      );
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? "사용량 조회 중 오류가 발생했습니다.");
        return;
      }
      setData(payload);
      setExpandedGroupId((current) => current ?? payload.groups?.[0]?.id ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "사용량 조회에 실패했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      void loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const summaryCards = data?.summary ?? {
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    uniqueUsers: 0,
    modelsUsed: 0,
    sessions: 0,
  };

  const pagination = data?.pagination ?? {
    page,
    pageSize,
    totalGroups: 0,
    totalPages: 1,
    pageSizeOptions: [30, 50, 100],
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                AI 사용량
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                한 번의 채팅 또는 한 번의 레슨 생성 실행을 한 묶음으로 보고, 토큰과 예상 비용까지 확인합니다.
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                시작일
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                종료일
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                표시 개수
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {pagination.pageSizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}개
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  setPage(1);
                  void loadData();
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {refreshing ? "조회 중..." : "조회"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Sessions</div>
              <div className="mt-2 text-3xl font-semibold">{formatNumber(summaryCards.sessions)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Requests</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.totalRequests)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Input</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.inputTokens)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Output</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.outputTokens)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total Tokens</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.totalTokens)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Estimated Cost</div>
              <div className="mt-2 text-xl font-semibold">{formatMoneyUsd(summaryCards.totalCostUsd)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Users</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.uniqueUsers)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Models</div>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(summaryCards.modelsUsed)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">세션별 사용 내역</h2>
              <p className="text-sm text-slate-500">
                {data ? `${data.range.from} ~ ${data.range.to}` : "선택한 기간의 로그를 보여줍니다."}
              </p>
            </div>
            <div className="text-sm text-slate-500">
              페이지 {pagination.page} / {pagination.totalPages} · 총 {formatNumber(pagination.totalGroups)}세션
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400">불러오는 중...</div>
          ) : error ? (
            <div className="px-5 py-12 text-sm text-rose-500">{error}</div>
          ) : !data || data.groups.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-400">선택한 기간에 사용 내역이 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.groups.map((group) => {
                const expanded = expandedGroupId === group.id;
                return (
                  <div key={group.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                      className="flex w-full flex-col gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-slate-900">{group.title}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {workflowLabel(group.workflow)}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {formatDateTime(group.startedAt)} ~ {formatDateTime(group.latestAt)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {group.user.name?.trim() || group.user.email || group.user.id} · {group.itemCount}회 호출
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                          <div>
                            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Tokens</div>
                            <div className="mt-1 font-semibold text-slate-900">{formatNumber(group.totalTokens)}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Input / Output</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {formatNumber(group.inputTokens)} / {formatNumber(group.outputTokens)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Estimated Cost</div>
                            <div className="mt-1 font-semibold text-slate-900">{formatMoneyUsd(group.estimatedCostUsd)}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">AI</div>
                            <div className="mt-1 font-semibold text-slate-900">{group.models.join(", ") || group.providers.join(", ")}</div>
                          </div>
                        </div>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/70">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-white text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            <tr>
                              <th className="px-5 py-3">사용일시</th>
                              <th className="px-5 py-3">사용된 AI</th>
                              <th className="px-5 py-3">에이전트/경로</th>
                              <th className="px-5 py-3">토큰</th>
                              <th className="px-5 py-3">예상 비용</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {group.items.map((item) => (
                              <tr key={item.id} className="align-top text-slate-700">
                                <td className="px-5 py-4">
                                  <div className="font-medium text-slate-900">{formatDateTime(item.createdAt)}</div>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="font-medium text-slate-900">{providerLabel(item.provider, item.model)}</div>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="font-medium text-slate-900">{compactAgentLabel(item.agent)}</div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    {item.workflow ?? item.endpoint ?? "-"}
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="font-medium text-slate-900">총 {formatNumber(item.totalTokens)}</div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    입력 {formatNumber(item.inputTokens)} / 출력 {formatNumber(item.outputTokens)}
                                  </div>
                                </td>
                                <td className="px-5 py-4 font-medium text-slate-900">
                                  {formatMoneyUsd(item.estimatedCostUsd)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && data && data.groups.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={pagination.page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이전
              </button>
              {Array.from({ length: pagination.totalPages }, (_, index) => index + 1)
                .slice(Math.max(0, pagination.page - 3), Math.min(pagination.totalPages, pagination.page + 2))
                .map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      pageNumber === pagination.page
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 text-slate-600"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(prev + 1, pagination.totalPages))}
                disabled={pagination.page >= pagination.totalPages}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
