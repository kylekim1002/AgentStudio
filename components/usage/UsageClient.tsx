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
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface UsageSummary {
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  uniqueUsers: number;
  modelsUsed: number;
}

interface UsagePayload {
  range: {
    from: string;
    to: string;
  };
  summary: UsageSummary;
  items: UsageItem[];
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}

function providerLabel(provider: string, model?: string | null) {
  if (model) return `${provider.toUpperCase()} · ${model}`;
  return provider.toUpperCase();
}

export default function UsageClient() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return formatDateInput(start);
  });
  const [to, setTo] = useState(() => formatDateInput(today));
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
      const res = await fetch(`/api/ops/ai-usage?from=${from}&to=${to}`, {
        cache: "no-store",
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? "사용량 조회 중 오류가 발생했습니다.");
        return;
      }
      setData(payload);
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

  const summaryCards = data?.summary ?? {
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    uniqueUsers: 0,
    modelsUsed: 0,
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
                기간별 AI API 사용 내역과 토큰 사용량을 사용자 단위로 확인합니다.
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
              <button
                onClick={() => void loadData()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {refreshing ? "조회 중..." : "조회"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Requests</div>
              <div className="mt-2 text-3xl font-semibold">{formatNumber(summaryCards.totalRequests)}</div>
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
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">사용 내역</h2>
              <p className="text-sm text-slate-500">
                {data ? `${data.range.from} ~ ${data.range.to}` : "선택한 기간의 로그를 보여줍니다."}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400">불러오는 중...</div>
          ) : error ? (
            <div className="px-5 py-12 text-sm text-rose-500">{error}</div>
          ) : !data || data.items.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-400">선택한 기간에 사용 내역이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">사용일시</th>
                    <th className="px-5 py-3">사용된 AI</th>
                    <th className="px-5 py-3">토큰 사용량</th>
                    <th className="px-5 py-3">사용자</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((item) => (
                    <tr key={item.id} className="align-top text-slate-700">
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">{formatDateTime(item.createdAt)}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {item.workflow ?? item.endpoint ?? "-"}
                          {item.agent ? ` · ${item.agent}` : ""}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          {providerLabel(item.provider, item.model)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          endpoint: {item.endpoint ?? "-"}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          총 {formatNumber(item.totalTokens)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          입력 {formatNumber(item.inputTokens)} / 출력 {formatNumber(item.outputTokens)}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          {item.user.name?.trim() || item.user.email || item.user.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {item.user.email || item.user.id}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
