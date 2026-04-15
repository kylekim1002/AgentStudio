import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type AIUsageLogInsert = Database["public"]["Tables"]["ai_usage_logs"]["Insert"];

export interface AIUsageLogPayload {
  userId?: string | null;
  provider: string;
  model?: string | null;
  workflow?: string | null;
  agent?: string | null;
  endpoint?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAIUsage(payload: AIUsageLogPayload) {
  if (!payload.userId) return;

  try {
    const supabase = await createServiceClient();
    const record: AIUsageLogInsert = {
      user_id: payload.userId,
      provider: payload.provider,
      model: payload.model ?? null,
      workflow: payload.workflow ?? null,
      agent: payload.agent ?? null,
      endpoint: payload.endpoint ?? null,
      input_tokens: payload.inputTokens ?? null,
      output_tokens: payload.outputTokens ?? null,
      total_tokens: payload.totalTokens ?? null,
      metadata: (payload.metadata ?? null) as Json,
    };
    await supabase.from("ai_usage_logs").insert(record as never);
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}
