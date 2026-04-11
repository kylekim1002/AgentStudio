import {
  ApprovalRequest,
  ApprovalStatus,
  RiskLevel,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowProgress,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

class WorkflowExecutionStore {
  private executions = new Map<string, WorkflowExecutionRecord>();
  private approvals = new Map<string, ApprovalRequest>();

  createExecution(params: {
    workflow: string;
    input: unknown;
    riskLevel?: RiskLevel;
    approvalStatus?: ApprovalStatus;
    status?: WorkflowExecutionStatus;
  }): WorkflowExecutionRecord {
    const timestamp = nowIso();
    const record: WorkflowExecutionRecord = {
      id: createId("wfexec"),
      workflow: params.workflow,
      status: params.status ?? "pending",
      approvalStatus: params.approvalStatus ?? "not_required",
      riskLevel: params.riskLevel ?? "safe",
      input: params.input,
      checkpoint: undefined,
      startedAt: timestamp,
      updatedAt: timestamp,
      steps: [],
    };
    this.executions.set(record.id, record);
    return record;
  }

  getExecution(id: string): WorkflowExecutionRecord | null {
    return this.executions.get(id) ?? null;
  }

  listExecutions(workflow?: string): WorkflowExecutionRecord[] {
    const items = Array.from(this.executions.values());
    const filtered = workflow ? items.filter((item) => item.workflow === workflow) : items;
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updateExecution(
    id: string,
    patch: Partial<Omit<WorkflowExecutionRecord, "id" | "steps" | "startedAt">>
  ): WorkflowExecutionRecord | null {
    const current = this.executions.get(id);
    if (!current) return null;
    const next: WorkflowExecutionRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    this.executions.set(id, next);
    return next;
  }

  appendStep(
    id: string,
    progress: WorkflowProgress<string>
  ): WorkflowExecutionRecord | null {
    const current = this.executions.get(id);
    if (!current) return null;
    const stepEvent = { ...progress, timestamp: nowIso() };
    const next: WorkflowExecutionRecord = {
      ...current,
      currentStep: progress.step,
      updatedAt: stepEvent.timestamp,
      steps: [...current.steps, stepEvent],
    };
    this.executions.set(id, next);
    return next;
  }

  createApproval(params: {
    workflow: string;
    executionId: string;
    step?: string;
    riskLevel: RiskLevel;
    title: string;
    summary: string;
  }): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: createId("approval"),
      workflow: params.workflow,
      executionId: params.executionId,
      step: params.step,
      riskLevel: params.riskLevel,
      title: params.title,
      summary: params.summary,
      status: "pending",
      createdAt: nowIso(),
    };
    this.approvals.set(approval.id, approval);
    this.updateExecution(params.executionId, {
      approvalStatus: "pending",
      status: "waiting_approval",
    });
    return approval;
  }

  getApproval(id: string): ApprovalRequest | null {
    return this.approvals.get(id) ?? null;
  }

  listApprovals(status?: ApprovalStatus): ApprovalRequest[] {
    const items = Array.from(this.approvals.values());
    const filtered = status ? items.filter((item) => item.status === status) : items;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  decideApproval(params: {
    approvalId: string;
    decision: "approved" | "rejected";
    decidedBy?: string;
    reason?: string;
  }): ApprovalRequest | null {
    const current = this.approvals.get(params.approvalId);
    if (!current) return null;
    const next: ApprovalRequest = {
      ...current,
      status: params.decision,
      decidedAt: nowIso(),
      decidedBy: params.decidedBy,
      reason: params.reason,
    };
    this.approvals.set(next.id, next);
    this.updateExecution(current.executionId, {
      approvalStatus: next.status,
      status: next.status === "approved" ? "pending" : "cancelled",
    });
    return next;
  }
}

export const workflowExecutionStore = new WorkflowExecutionStore();

export type { WorkflowExecutionStore };
