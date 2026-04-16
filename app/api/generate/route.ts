import { NextRequest } from "next/server";
import { createWorkflowEventStream } from "@/lib/workflows/core/executeWorkflow";
import { registerBuiltinWorkflows } from "@/lib/workflows/registerBuiltins";
import { AIProvider } from "@/lib/workflows/core/types";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  AgentName,
  ContentCounts,
  ContentCheckpoint,
  DifficultyLevel,
  LessonRequest,
  PassageCheckpoint,
} from "@/lib/workflows/lesson/types";
import { CurriculumReferencePayload } from "@/lib/curriculum";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  registerBuiltinWorkflows();
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("studio.generate")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { userInput, provider, difficulty, providedPassage, contentCounts, generationTarget, passageCheckpoint, contentCheckpoint, regenerateAgents, revisionInstructions } = body as {
    userInput?: string;
    provider?: string;
    difficulty?: string;
    requestedLevelName?: string;
    requestedOfficialDifficulty?: string;
    requestedLexileMin?: number;
    requestedLexileMax?: number;
    providedPassage?: string;
    approvalMode?: "auto" | "require_review";
    contentCounts?: ContentCounts;
    generationTarget?: "full" | "passage_review" | "content_review" | "passage_and_content_review";
    passageCheckpoint?: PassageCheckpoint;
    contentCheckpoint?: ContentCheckpoint;
    regenerateAgents?: AgentName[];
    revisionInstructions?: Partial<Record<AgentName, string>>;
    curriculumMode?: "standard" | "curriculum";
    curriculumReference?: CurriculumReferencePayload | null;
  };

  // Load user's saved API keys from profile settings
  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const apiKeys = (settings.apiKeys ?? {}) as {
    anthropic?: string;
    openai?: string;
    google?: string;
  };

  const resolvedProvider =
    provider === AIProvider.CLAUDE ||
    provider === AIProvider.GPT ||
    provider === AIProvider.GEMINI
      ? provider
      : null;

  if (!userInput || typeof userInput !== "string") {
    return new Response(JSON.stringify({ error: "userInput is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (access.features.includes("studio.provider_select") && !resolvedProvider) {
    return new Response(JSON.stringify({ error: "Invalid provider" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sanitize contentCounts — clamp to safe ranges (1..30)
  const clamp = (n: unknown, min: number, max: number, fallback: number) => {
    const num = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(Math.max(Math.floor(num), min), max);
  };
  const safeCounts: ContentCounts | undefined = contentCounts
    ? {
        reading: contentCounts.reading !== undefined ? clamp(contentCounts.reading, 1, 30, 5) : undefined,
        vocabulary: contentCounts.vocabulary !== undefined ? clamp(contentCounts.vocabulary, 1, 30, 8) : undefined,
        assessment: contentCounts.assessment !== undefined ? clamp(contentCounts.assessment, 1, 30, 10) : undefined,
        grammarExercises: contentCounts.grammarExercises !== undefined ? clamp(contentCounts.grammarExercises, 1, 20, 8) : undefined,
        writing: contentCounts.writing !== undefined ? clamp(contentCounts.writing, 1, 10, 1) : undefined,
      }
    : undefined;

  const safeLexileValue = (value: unknown) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : undefined;
  };

  const lessonRequest: LessonRequest = {
    userInput,
    userId: user.id,
    provider: access.features.includes("studio.provider_select")
      ? (resolvedProvider ?? AIProvider.CLAUDE)
      : AIProvider.CLAUDE,
    difficulty: difficulty as DifficultyLevel | undefined,
    requestedLevelName:
      body && typeof body === "object" && typeof (body as { requestedLevelName?: unknown }).requestedLevelName === "string"
        ? ((body as { requestedLevelName?: string }).requestedLevelName || undefined)
        : undefined,
    requestedOfficialDifficulty:
      body && typeof body === "object" && typeof (body as { requestedOfficialDifficulty?: unknown }).requestedOfficialDifficulty === "string"
        ? ((body as { requestedOfficialDifficulty?: string }).requestedOfficialDifficulty || undefined)
        : undefined,
    requestedLexileMin: safeLexileValue(
      body && typeof body === "object" ? (body as { requestedLexileMin?: unknown }).requestedLexileMin : undefined
    ),
    requestedLexileMax: safeLexileValue(
      body && typeof body === "object" ? (body as { requestedLexileMax?: unknown }).requestedLexileMax : undefined
    ),
    providedPassage,
    generationTarget:
      generationTarget === "passage_review" ||
      generationTarget === "content_review" ||
      generationTarget === "passage_and_content_review"
        ? generationTarget
        : "full",
    passageCheckpoint,
    contentCheckpoint,
    regenerateAgents,
    revisionInstructions,
    curriculumMode:
      body && typeof body === "object" && (body as { curriculumMode?: unknown }).curriculumMode === "curriculum"
        ? "curriculum"
        : "standard",
    curriculumReference:
      body && typeof body === "object"
        ? ((body as { curriculumReference?: CurriculumReferencePayload | null }).curriculumReference ?? null)
        : null,
    contentCounts: safeCounts,
    approvalMode: access.features.includes("studio.approval_toggle")
      ? (body && typeof body === "object"
        ? (body as { approvalMode?: "auto" | "require_review" }).approvalMode
        : undefined)
      : "auto",
    apiKeys: {
      anthropic: typeof apiKeys.anthropic === "string" && apiKeys.anthropic ? apiKeys.anthropic : undefined,
      openai:    typeof apiKeys.openai    === "string" && apiKeys.openai    ? apiKeys.openai    : undefined,
      google:    typeof apiKeys.google    === "string" && apiKeys.google    ? apiKeys.google    : undefined,
    },
  };

  const { stream } = createWorkflowEventStream({
    workflow: "lesson_generation",
    input: lessonRequest,
    formatProgress(event) {
      return {
        type: "progress",
        executionId: event.executionId,
        workflow: event.workflow,
        agent: event.step,
        status: event.status,
        output: event.output,
        error: event.error,
      };
    },
    formatComplete(event) {
      const result = event.result as Record<string, unknown>;
      if (result?.kind === "passage_review") {
        return {
          type: "passage_review",
          executionId: event.executionId,
          checkpoint: result.checkpoint,
        };
      }
      if (result?.kind === "content_review") {
        return {
          type: "content_review",
          executionId: event.executionId,
          checkpoint: result.checkpoint,
        };
      }
      return {
        type: "complete",
        executionId: event.executionId,
        package: event.result,
      };
    },
    formatError(event) {
      return {
        type: "error",
        executionId: event.executionId,
        error: event.error,
      };
    },
    formatApprovalRequired(event) {
      return {
        type: "approval_required",
        executionId: event.executionId,
        approvalId: event.approvalId,
        workflow: event.workflow,
        title: event.title,
        summary: event.summary,
        riskLevel: event.riskLevel,
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
