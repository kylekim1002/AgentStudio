import { NextRequest } from "next/server";
import { createWorkflowEventStream } from "@/lib/workflows/core/executeWorkflow";
import { registerBuiltinWorkflows } from "@/lib/workflows/registerBuiltins";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  registerBuiltinWorkflows();

  let body: { workflow?: string; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.workflow || typeof body.workflow !== "string") {
    return new Response(JSON.stringify({ error: "workflow is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { stream } = createWorkflowEventStream({
      workflow: body.workflow,
      input: body.input ?? {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow setup failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
