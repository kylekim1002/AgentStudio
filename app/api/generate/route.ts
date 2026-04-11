import { NextRequest } from "next/server";
import { createWorkflowEventStream } from "@/lib/workflows/core/executeWorkflow";
import { registerBuiltinWorkflows } from "@/lib/workflows/registerBuiltins";
import { AIProvider } from "@/lib/workflows/core/types";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  DifficultyLevel,
  LessonRequest,
} from "@/lib/workflows/lesson/types";

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

  const { userInput, provider, difficulty, providedPassage } = body as {
    userInput?: string;
    provider?: string;
    difficulty?: string;
    providedPassage?: string;
    approvalMode?: "auto" | "require_review";
  };

  if (!userInput || typeof userInput !== "string") {
    return new Response(JSON.stringify({ error: "userInput is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const lessonRequest: LessonRequest = {
    userInput,
    provider: access.features.includes("studio.provider_select")
      ? ((provider as AIProvider) ?? AIProvider.CLAUDE)
      : AIProvider.CLAUDE,
    difficulty: difficulty as DifficultyLevel | undefined,
    providedPassage,
    approvalMode: access.features.includes("studio.approval_toggle")
      ? (body && typeof body === "object"
        ? (body as { approvalMode?: "auto" | "require_review" }).approvalMode
        : undefined)
      : "auto",
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
