import { NextRequest, NextResponse } from "next/server";
import { workflowExecutionStore } from "@/lib/workflows/core/executionStore";
import {
  persistApprovalRequest,
  persistWorkflowExecution,
} from "@/lib/workflows/core/persistence";
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
  if (!access.features.includes("approval.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const approval = workflowExecutionStore.getApproval(params.id);
  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  return NextResponse.json({ approval });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
  let body: {
    decision?: "approved" | "rejected";
    decidedBy?: string;
    reason?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be approved or rejected" },
      { status: 400 }
    );
  }

  const approval = workflowExecutionStore.decideApproval({
    approvalId: params.id,
    decision: body.decision,
    decidedBy: body.decidedBy,
    reason: body.reason,
  });

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  void persistApprovalRequest(approval);
  void persistWorkflowExecution(
    workflowExecutionStore.getExecution(approval.executionId)
  );

  return NextResponse.json({ approval });
}
