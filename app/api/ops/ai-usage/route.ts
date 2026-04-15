import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import type { Database } from "@/lib/supabase/types";

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
    .select("id, user_id, provider, model, workflow, agent, endpoint, input_tokens, output_tokens, total_tokens, created_at")
    .gte("created_at", fromDate.toISOString())
    .lte("created_at", toDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);

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
      profileMap.set(profile.id, {
        name: profile.name,
        email: profile.email,
      });
    }
  }

  const items = usageLogs.map((item) => {
    const profile = profileMap.get(item.user_id);
    return {
      id: item.id,
      createdAt: item.created_at,
      provider: item.provider,
      model: item.model,
      workflow: item.workflow,
      agent: item.agent,
      endpoint: item.endpoint,
      inputTokens: item.input_tokens,
      outputTokens: item.output_tokens,
      totalTokens: item.total_tokens,
      user: {
        id: item.user_id,
        name: profile?.name ?? null,
        email: profile?.email ?? "",
      },
    };
  });

  const summary = items.reduce(
    (acc, item) => {
      acc.totalRequests += 1;
      acc.inputTokens += item.inputTokens ?? 0;
      acc.outputTokens += item.outputTokens ?? 0;
      acc.totalTokens += item.totalTokens ?? 0;
      acc.users.add(item.user.id);
      acc.models.add(item.model ?? item.provider);
      return acc;
    },
    {
      totalRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      users: new Set<string>(),
      models: new Set<string>(),
    }
  );

  return NextResponse.json({
    range: {
      from: fromValue,
      to: toValue,
    },
    summary: {
      totalRequests: summary.totalRequests,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      uniqueUsers: summary.users.size,
      modelsUsed: summary.models.size,
    },
    items,
  });
}
