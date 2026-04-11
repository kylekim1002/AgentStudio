import { NextRequest, NextResponse } from "next/server";
import { workflowExecutionStore } from "@/lib/workflows/core/executionStore";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
  const execution = workflowExecutionStore.getExecution(params.id);
  if (!execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 });
  }
  return NextResponse.json({ execution });
}
