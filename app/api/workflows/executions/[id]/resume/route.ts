import { NextRequest } from "next/server";
import { registerBuiltinWorkflows } from "@/lib/workflows/registerBuiltins";
import { resumeWorkflowEventStream } from "@/lib/workflows/core/executeWorkflow";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
  if (!access.features.includes("approval.manage")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { stream } = resumeWorkflowEventStream({
      executionId: params.id,
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
    const message = error instanceof Error ? error.message : "Resume failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
