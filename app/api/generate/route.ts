import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/agents/pipeline";
import { LessonRequest, AIProvider, DifficultyLevel, AgentProgress } from "@/lib/agents/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function sseMessage(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
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
  };

  if (!userInput || typeof userInput !== "string") {
    return new Response(JSON.stringify({ error: "userInput is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const lessonRequest: LessonRequest = {
    userInput,
    provider: (provider as AIProvider) ?? AIProvider.CLAUDE,
    difficulty: difficulty as DifficultyLevel | undefined,
    providedPassage,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(sseMessage(data)));
      };

      try {
        const onProgress = (progress: AgentProgress) => {
          enqueue({ type: "progress", ...progress });
        };

        const lessonPackage = await runPipeline(lessonRequest, onProgress);

        enqueue({ type: "complete", package: lessonPackage });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pipeline failed";
        enqueue({ type: "error", error: message });
      } finally {
        controller.close();
      }
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
