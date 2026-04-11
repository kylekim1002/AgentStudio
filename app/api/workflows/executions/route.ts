import { NextRequest, NextResponse } from "next/server";
import { workflowExecutionStore } from "@/lib/workflows/core/executionStore";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("ops.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const workflow = searchParams.get("workflow") ?? undefined;
  const executions = workflowExecutionStore.listExecutions(workflow);
  return NextResponse.json({ executions });
}
