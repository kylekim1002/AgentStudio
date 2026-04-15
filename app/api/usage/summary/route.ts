import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

type AIUsageLogRow = Database["public"]["Tables"]["ai_usage_logs"]["Row"];

function startOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = await createServiceClient();
  const from = startOfMonth().toISOString();

  const { data, error } = await serviceSupabase
    .from("ai_usage_logs")
    .select("provider, total_tokens, created_at")
    .eq("user_id", user.id)
    .gte("created_at", from);

  if (error) {
    return NextResponse.json({ error: "사용량 요약을 불러오지 못했습니다." }, { status: 500 });
  }

  const logs = (data ?? []) as Pick<AIUsageLogRow, "provider" | "total_tokens" | "created_at">[];
  const summary = {
    totalTokens: 0,
    totalRequests: logs.length,
    byProvider: {
      claude: 0,
      gpt: 0,
      gemini: 0,
    },
  };

  for (const item of logs) {
    const total = item.total_tokens ?? 0;
    summary.totalTokens += total;
    const provider = item.provider?.toLowerCase();
    if (provider === "claude" || provider === "gpt" || provider === "gemini") {
      summary.byProvider[provider] += total;
    }
  }

  return NextResponse.json({
    range: {
      from,
      to: new Date().toISOString(),
    },
    summary,
  });
}
