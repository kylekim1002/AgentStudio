import { ApprovalRequiredError } from "./errors";
import { workflowExecutionStore } from "./executionStore";
import {
  persistApprovalRequest,
  persistWorkflowExecution,
} from "./persistence";
import {
  RiskLevel,
  WorkflowExecutionRecord,
  WorkflowProgress,
  WorkflowRuntime,
  WorkflowStepStatus,
} from "./types";

type ProgressEmitter = (event: {
  executionId: string;
  workflow: string;
  step: string;
  status: WorkflowStepStatus;
  output?: unknown;
  error?: string;
}) => void;

function normalizeProgressStatus(status: string): WorkflowStepStatus {
  if (
    status === "pending" ||
    status === "running" ||
    status === "done" ||
    status === "skipped" ||
    status === "error"
  ) {
    return status;
  }
  return "error";
}

export function createExecutionRuntime<TStep extends string>(params: {
  workflow: string;
  execution: WorkflowExecutionRecord;
  emitProgress: ProgressEmitter;
}): WorkflowRuntime<TStep> {
  const { workflow, execution, emitProgress } = params;

  const emit = (progress: Omit<WorkflowProgress<TStep>, "workflow">) => {
    const normalized: WorkflowProgress<string> = {
      workflow,
      step: progress.step,
      status: normalizeProgressStatus(progress.status),
      output: progress.output,
      error: progress.error,
    };
    const updatedExecution = workflowExecutionStore.appendStep(execution.id, normalized);
    void persistWorkflowExecution(updatedExecution);
    emitProgress({
      executionId: execution.id,
      workflow,
      step: normalized.step,
      status: normalized.status,
      output: normalized.output,
      error: normalized.error,
    });
  };

  const step = async <T>(stepName: TStep, run: () => Promise<T>): Promise<T> => {
    emit({ step: stepName, status: "running" });
    try {
      const output = await run();
      emit({ step: stepName, status: "done", output });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ step: stepName, status: "error", error: message });
      throw error;
    }
  };

  const setCheckpoint = (checkpoint: unknown) => {
    const updatedExecution = workflowExecutionStore.updateExecution(execution.id, {
      checkpoint,
    });
    void persistWorkflowExecution(updatedExecution);
  };

  const requestApproval = async (approval: {
    step?: TStep;
    riskLevel: RiskLevel;
    title: string;
    summary: string;
  }): Promise<never> => {
    const createdApproval = workflowExecutionStore.createApproval({
      workflow,
      executionId: execution.id,
      step: approval.step,
      riskLevel: approval.riskLevel,
      title: approval.title,
      summary: approval.summary,
    });
    void persistApprovalRequest(createdApproval);
    void persistWorkflowExecution(workflowExecutionStore.getExecution(execution.id));
    throw new ApprovalRequiredError({
      approvalId: createdApproval.id,
      executionId: execution.id,
      workflow,
      message: approval.summary,
    });
  };

  return { workflow, emit, step, setCheckpoint, requestApproval };
}
