import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { ApprovalRequest, WorkflowExecutionRecord } from "./types";

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function isPersistenceConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function persistWorkflowExecution(
  execution: WorkflowExecutionRecord | null
): Promise<void> {
  if (!execution || !isPersistenceConfigured()) return;

  try {
    const supabase = await createServiceClient();
    const { error } = await (supabase as any).from("workflow_executions").upsert({
      id: execution.id,
      workflow: execution.workflow,
      status: execution.status,
      approval_status: execution.approvalStatus,
      risk_level: execution.riskLevel,
      current_step: execution.currentStep ?? null,
      checkpoint: toJson(execution.checkpoint),
      input: toJson(execution.input),
      result: toJson(execution.result),
      error: execution.error ?? null,
      steps: toJson(execution.steps),
      started_at: execution.startedAt,
      completed_at: execution.completedAt ?? null,
      updated_at: execution.updatedAt,
    });

    if (error) {
      console.warn("Failed to persist workflow execution:", error.message);
    }
  } catch (error) {
    console.warn("Workflow execution persistence unavailable:", error);
  }
}

export async function persistApprovalRequest(
  approval: ApprovalRequest | null
): Promise<void> {
  if (!approval || !isPersistenceConfigured()) return;

  try {
    const supabase = await createServiceClient();
    const { error } = await (supabase as any).from("approval_requests").upsert({
      id: approval.id,
      workflow: approval.workflow,
      execution_id: approval.executionId,
      step: approval.step ?? null,
      risk_level: approval.riskLevel,
      title: approval.title,
      summary: approval.summary,
      status: approval.status,
      created_at: approval.createdAt,
      decided_at: approval.decidedAt ?? null,
      decided_by: approval.decidedBy ?? null,
      reason: approval.reason ?? null,
    });

    if (error) {
      console.warn("Failed to persist approval request:", error.message);
    }
  } catch (error) {
    console.warn("Approval persistence unavailable:", error);
  }
}
