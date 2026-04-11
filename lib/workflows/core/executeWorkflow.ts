import { classifyRiskLevel } from "./approval";
import { ApprovalRequiredError } from "./errors";
import { workflowExecutionStore } from "./executionStore";
import { persistWorkflowExecution } from "./persistence";
import { getWorkflowDefinition } from "./registry";
import { createExecutionRuntime } from "./runtimeFactory";
import { WorkflowExecutionRecord, WorkflowStepStatus } from "./types";

function sseMessage(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type BaseProgressEvent = {
  type: "progress";
  executionId: string;
  workflow: string;
  step: string;
  status: WorkflowStepStatus;
  output?: unknown;
  error?: string;
};

type BaseCompleteEvent = {
  type: "complete";
  executionId: string;
  workflow: string;
  result: unknown;
};

type BaseErrorEvent = {
  type: "error";
  executionId: string;
  workflow: string;
  error: string;
};

type BaseApprovalEvent = {
  type: "approval_required";
  executionId: string;
  workflow: string;
  approvalId: string;
  title: string;
  summary: string;
  riskLevel: "safe" | "review" | "critical";
};

interface WorkflowEventStreamOptions {
  execution: WorkflowExecutionRecord;
  workflow: string;
  input: unknown;
  useResume?: boolean;
  formatProgress: (event: BaseProgressEvent) => unknown;
  formatComplete: (event: BaseCompleteEvent) => unknown;
  formatError: (event: BaseErrorEvent) => unknown;
  formatApprovalRequired: (event: BaseApprovalEvent) => unknown;
}

interface ExecuteWorkflowStreamOptions {
  workflow: string;
  input: unknown;
  formatProgress?: (event: BaseProgressEvent) => unknown;
  formatComplete?: (event: BaseCompleteEvent) => unknown;
  formatError?: (event: BaseErrorEvent) => unknown;
  formatApprovalRequired?: (event: BaseApprovalEvent) => unknown;
}

function buildWorkflowEventStream(
  options: WorkflowEventStreamOptions
): ReadableStream<Uint8Array> {
  const definition = getWorkflowDefinition(options.workflow);
  if (!definition) {
    throw new Error(`Unknown workflow: ${options.workflow}`);
  }

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(sseMessage(data)));
      };

      try {
        const runtime = createExecutionRuntime({
          workflow: definition.name,
          execution: options.execution,
          emitProgress(event) {
            enqueue(options.formatProgress({ type: "progress", ...event }));
          },
        });

        const result =
          options.useResume && definition.resume
            ? await definition.resume(options.input, runtime, options.execution.checkpoint)
            : await definition.run(options.input, runtime);

        const completedExecution = workflowExecutionStore.updateExecution(options.execution.id, {
          status: "completed",
          result,
          completedAt: new Date().toISOString(),
          checkpoint: undefined,
        });
        void persistWorkflowExecution(completedExecution);

        enqueue(
          options.formatComplete({
            type: "complete",
            executionId: options.execution.id,
            workflow: definition.name,
            result,
          })
        );
      } catch (error) {
        if (error instanceof ApprovalRequiredError) {
          const approval = workflowExecutionStore.getApproval(error.approvalId);
          if (approval) {
            enqueue(
              options.formatApprovalRequired({
                type: "approval_required",
                executionId: error.executionId,
                workflow: error.workflow,
                approvalId: approval.id,
                title: approval.title,
                summary: approval.summary,
                riskLevel: approval.riskLevel,
              })
            );
          }
          controller.close();
          return;
        }

        const message = error instanceof Error ? error.message : "Workflow failed";
        const failedExecution = workflowExecutionStore.updateExecution(options.execution.id, {
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
        });
        void persistWorkflowExecution(failedExecution);
        enqueue(
          options.formatError({
            type: "error",
            executionId: options.execution.id,
            workflow: definition.name,
            error: message,
          })
        );
      } finally {
        controller.close();
      }
    },
  });
}

export function createWorkflowEventStream(
  options: ExecuteWorkflowStreamOptions
): {
  execution: WorkflowExecutionRecord;
  stream: ReadableStream<Uint8Array>;
} {
  const definition = getWorkflowDefinition(options.workflow);
  if (!definition) {
    throw new Error(`Unknown workflow: ${options.workflow}`);
  }

  const execution = workflowExecutionStore.createExecution({
    workflow: options.workflow,
    input: options.input,
    riskLevel: classifyRiskLevel(options.workflow, options.input),
  });
  const runningExecution = workflowExecutionStore.updateExecution(execution.id, {
    status: "running",
  })!;
  void persistWorkflowExecution(runningExecution);

  const formatProgress = options.formatProgress ?? ((event) => event);
  const formatComplete = options.formatComplete ?? ((event) => event);
  const formatError = options.formatError ?? ((event) => event);
  const formatApprovalRequired = options.formatApprovalRequired ?? ((event) => event);

  return {
    execution: runningExecution,
    stream: buildWorkflowEventStream({
      execution: runningExecution,
      workflow: options.workflow,
      input: options.input,
      formatProgress,
      formatComplete,
      formatError,
      formatApprovalRequired,
    }),
  };
}

export function resumeWorkflowEventStream(params: {
  executionId: string;
  formatProgress?: (event: BaseProgressEvent) => unknown;
  formatComplete?: (event: BaseCompleteEvent) => unknown;
  formatError?: (event: BaseErrorEvent) => unknown;
  formatApprovalRequired?: (event: BaseApprovalEvent) => unknown;
}): {
  execution: WorkflowExecutionRecord;
  stream: ReadableStream<Uint8Array>;
} {
  const execution = workflowExecutionStore.getExecution(params.executionId);
  if (!execution) {
    throw new Error(`Execution not found: ${params.executionId}`);
  }
  if (execution.approvalStatus !== "approved") {
    throw new Error("Execution is not approved for resume");
  }

  const resumedExecution = workflowExecutionStore.updateExecution(execution.id, {
    status: "running",
    error: undefined,
    completedAt: undefined,
  })!;
  void persistWorkflowExecution(resumedExecution);

  return {
    execution: resumedExecution,
    stream: buildWorkflowEventStream({
      execution: resumedExecution,
      workflow: resumedExecution.workflow,
      input: resumedExecution.input,
      useResume: true,
      formatProgress: params.formatProgress ?? ((event) => event),
      formatComplete: params.formatComplete ?? ((event) => event),
      formatError: params.formatError ?? ((event) => event),
      formatApprovalRequired: params.formatApprovalRequired ?? ((event) => event),
    }),
  };
}
