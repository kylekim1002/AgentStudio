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
  if (!access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const approvals = workflowExecutionStore.listApprovals(
    status as "not_required" | "pending" | "approved" | "rejected" | "expired" | undefined
  );
  return NextResponse.json({ approvals });
}
