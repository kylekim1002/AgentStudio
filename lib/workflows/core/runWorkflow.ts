import {
  OnWorkflowProgress,
  RiskLevel,
  WorkflowDefinition,
  WorkflowProgress,
  WorkflowRuntime,
} from "./types";
import { ApprovalRequiredError } from "./errors";

function createWorkflowRuntime<TStep extends string>(
  workflow: string,
  onProgress: OnWorkflowProgress<TStep>
): WorkflowRuntime<TStep> {
  const emit = (progress: Omit<WorkflowProgress<TStep>, "workflow">) => {
    onProgress({ workflow, ...progress });
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

  const setCheckpoint = (_checkpoint: unknown) => {};

  const requestApproval = async (params: {
    step?: TStep;
    riskLevel: RiskLevel;
    title: string;
    summary: string;
  }): Promise<never> => {
    throw new ApprovalRequiredError({
      approvalId: "local-approval",
      executionId: "local-execution",
      workflow,
      message: `${params.title}: ${params.summary}`,
    });
  };

  return { workflow, emit, step, setCheckpoint, requestApproval };
}

export async function runWorkflow<TRequest, TResult, TStep extends string>(
  definition: WorkflowDefinition<TRequest, TResult, TStep>,
  request: TRequest,
  onProgress: OnWorkflowProgress<TStep>
): Promise<TResult> {
  const runtime = createWorkflowRuntime(definition.name, onProgress);
  return definition.run(request, runtime);
}
