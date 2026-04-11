export enum AIProvider {
  CLAUDE = "claude",
  GPT = "gpt",
  GEMINI = "gemini",
}

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "error";

export interface WorkflowProgress<TStep extends string = string> {
  workflow: string;
  step: TStep;
  status: WorkflowStepStatus;
  output?: unknown;
  error?: string;
}

export type OnWorkflowProgress<TStep extends string = string> = (
  progress: WorkflowProgress<TStep>
) => void;

export interface WorkflowRuntime<TStep extends string = string> {
  workflow: string;
  emit: (progress: Omit<WorkflowProgress<TStep>, "workflow">) => void;
  step: <T>(stepName: TStep, run: () => Promise<T>) => Promise<T>;
  setCheckpoint: (checkpoint: unknown) => void;
  requestApproval: (params: {
    step?: TStep;
    riskLevel: RiskLevel;
    title: string;
    summary: string;
  }) => Promise<never>;
}

export interface WorkflowApprovalPolicy<
  TRequest,
  TData = unknown,
  TStep extends string = string,
> {
  id: string;
  step: TStep;
  riskLevel: RiskLevel;
  shouldRequest?: (request: TRequest) => boolean;
  buildApproval: (params: {
    request: TRequest;
    data: TData;
  }) => {
    title: string;
    summary: string;
  };
  buildCheckpoint?: (params: {
    request: TRequest;
    data: TData;
  }) => unknown;
}

export interface WorkflowDefinition<
  TRequest,
  TResult,
  TStep extends string = string,
> {
  name: string;
  run: (request: TRequest, runtime: WorkflowRuntime<TStep>) => Promise<TResult>;
  resume?: (
    request: TRequest,
    runtime: WorkflowRuntime<TStep>,
    checkpoint: unknown
  ) => Promise<TResult>;
  approvalPolicies?: Array<WorkflowApprovalPolicy<TRequest, unknown, TStep>>;
}

export type WorkflowExecutionStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export type RiskLevel = "safe" | "review" | "critical";

export interface ApprovalRequest {
  id: string;
  workflow: string;
  executionId: string;
  step?: string;
  riskLevel: RiskLevel;
  title: string;
  summary: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  workflow: string;
  status: WorkflowExecutionStatus;
  approvalStatus: ApprovalStatus;
  riskLevel: RiskLevel;
  input: unknown;
  result?: unknown;
  error?: string;
  currentStep?: string;
  checkpoint?: unknown;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  steps: Array<WorkflowProgress<string> & { timestamp: string }>;
}
