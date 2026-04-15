import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import type { Database, Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

type AIUsageLogRow = Database["public"]["Tables"]["ai_usage_logs"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00.000+09:00`);
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999+09:00`);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function asMeta(value: Json | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function estimateCostUsd(provider: string, model: string | null, inputTokens: number, outputTokens: number) {
  const key = `${provider}:${model ?? ""}`.toLowerCase();
  const pricing: Record<string, { inputPer1M: number; outputPer1M: number }> = {
    "claude:claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
    "gpt:gpt-4o": { inputPer1M: 5, outputPer1M: 15 },
    "gemini:gemini-1.5-pro": { inputPer1M: 3.5, outputPer1M: 10.5 },
  };

  const matched =
    pricing[key] ??
    pricing[`${provider.toLowerCase()}:`] ??
    (provider.toLowerCase() === "claude"
      ? pricing["claude:claude-opus-4-6"]
      : provider.toLowerCase() === "gpt"
        ? pricing["gpt:gpt-4o"]
        : provider.toLowerCase() === "gemini"
          ? pricing["gemini:gemini-1.5-pro"]
          : null);

  if (!matched) return 0;

  return (inputTokens / 1_000_000) * matched.inputPer1M + (outputTokens / 1_000_000) * matched.outputPer1M;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("ops.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 6);

  const fromValue = params.get("from") ?? formatDateInput(defaultFrom);
  const toValue = params.get("to") ?? formatDateInput(today);
  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = Math.min(parsePositiveInt(params.get("pageSize"), 30), 100);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromValue) || !/^\d{4}-\d{2}-\d{2}$/.test(toValue)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const fromDate = startOfDay(fromValue);
  const toDate = endOfDay(toValue);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: "조회 기간이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceSupabase = await createServiceClient();
  const { data: logs, error } = await serviceSupabase
    .from("ai_usage_logs")
    .select("id, user_id, provider, model, workflow, agent, endpoint, input_tokens, output_tokens, total_tokens, metadata, created_at")
    .gte("created_at", fromDate.toISOString())
    .lte("created_at", toDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: "사용량 조회에 실패했습니다." }, { status: 500 });
  }

  const usageLogs = (logs ?? []) as AIUsageLogRow[];
  const userIds = Array.from(new Set(usageLogs.map((item) => item.user_id).filter(Boolean)));
  const profileMap = new Map<string, { name: string | null; email: string }>();

  if (userIds.length > 0) {
    const { data: profiles } = await serviceSupabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileRows = (profiles ?? []) as Pick<ProfileRow, "id" | "name" | "email">[];
    for (const profile of profileRows) {
      profileMap.set(profile.id, { name: profile.name, email: profile.email });
    }
  }

  const items = usageLogs.map((item) => {
    const profile = profileMap.get(item.user_id);
    const metadata = asMeta(item.metadata);
    const inputTokens = item.input_tokens ?? 0;
    const outputTokens = item.output_tokens ?? 0;
    const totalTokens = item.total_tokens ?? inputTokens + outputTokens;
    return {
      id: item.id,
      createdAt: item.created_at,
      provider: item.provider,
      model: item.model,
      workflow: item.workflow,
      agent: item.agent,
      endpoint: item.endpoint,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: estimateCostUsd(item.provider, item.model, inputTokens, outputTokens),
      metadata,
      user: {
        id: item.user_id,
        name: profile?.name ?? null,
        email: profile?.email ?? "",
      },
    };
  });

  const groupsMap = new Map<string, {
    id: string;
    title: string;
    latestAt: string;
    startedAt: string;
    workflow: string | null;
    items: typeof items;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    providers: Set<string>;
    models: Set<string>;
    user: { id: string; name: string | null; email: string };
  }>();

  for (const item of items) {
    const meta = item.metadata;
    const groupId =
      (typeof meta.sessionId === "string" && meta.sessionId) ||
      (typeof meta.executionId === "string" && meta.executionId) ||
      item.id;
    const groupTitle =
      (typeof meta.sessionTitle === "string" && meta.sessionTitle.trim()) ||
      (item.workflow === "lesson_generation"
        ? "레슨 생성 실행"
        : item.workflow === "studio_chat"
          ? "스튜디오 채팅"
          : item.workflow === "agent_chat"
            ? `${item.agent ?? "에이전트"} 대화`
            : "AI 사용 세션");

    const existing = groupsMap.get(groupId);
    if (!existing) {
      groupsMap.set(groupId, {
        id: groupId,
        title: groupTitle,
        latestAt: item.createdAt,
        startedAt: item.createdAt,
        workflow: item.workflow,
        items: [item],
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        totalTokens: item.totalTokens,
        estimatedCostUsd: item.estimatedCostUsd,
        providers: new Set([item.provider]),
        models: new Set(item.model ? [item.model] : []),
        user: item.user,
      });
      continue;
    }

    existing.items.push(item);
    existing.inputTokens += item.inputTokens;
    existing.outputTokens += item.outputTokens;
    existing.totalTokens += item.totalTokens;
    existing.estimatedCostUsd += item.estimatedCostUsd;
    existing.providers.add(item.provider);
    if (item.model) existing.models.add(item.model);
    if (item.createdAt > existing.latestAt) existing.latestAt = item.createdAt;
    if (item.createdAt < existing.startedAt) existing.startedAt = item.createdAt;
  }

  const groups = Array.from(groupsMap.values())
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
    .map((group) => ({
      id: group.id,
      title: group.title,
      latestAt: group.latestAt,
      startedAt: group.startedAt,
      workflow: group.workflow,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      totalTokens: group.totalTokens,
      estimatedCostUsd: Number(group.estimatedCostUsd.toFixed(6)),
      itemCount: group.items.length,
      providers: Array.from(group.providers),
      models: Array.from(group.models),
      user: group.user,
      items: group.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }));

  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedGroups = groups.slice(startIndex, startIndex + pageSize);

  const summary = items.reduce(
    (acc, item) => {
      acc.totalRequests += 1;
      acc.inputTokens += item.inputTokens;
      acc.outputTokens += item.outputTokens;
      acc.totalTokens += item.totalTokens;
      acc.totalCostUsd += item.estimatedCostUsd;
      acc.users.add(item.user.id);
      acc.models.add(item.model ?? item.provider);
      return acc;
    },
    {
      totalRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      users: new Set<string>(),
      models: new Set<string>(),
    }
  );

  return NextResponse.json({
    range: { from: fromValue, to: toValue },
    pagination: {
      page: safePage,
      pageSize,
      totalGroups,
      totalPages,
      pageSizeOptions: [30, 50, 100],
    },
    summary: {
      totalRequests: summary.totalRequests,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      totalCostUsd: Number(summary.totalCostUsd.toFixed(6)),
      uniqueUsers: summary.users.size,
      modelsUsed: summary.models.size,
      sessions: totalGroups,
    },
    groups: pagedGroups,
  });
}
