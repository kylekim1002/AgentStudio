import {
  WorkflowApprovalPolicy,
  WorkflowDefinition,
  WorkflowRuntime,
} from "./types";

function getApprovalPolicy<TRequest, TStep extends string>(
  definition: WorkflowDefinition<TRequest, unknown, TStep>,
  step: TStep,
  request: TRequest
): WorkflowApprovalPolicy<TRequest, unknown, TStep> | null {
  const policy =
    definition.approvalPolicies?.find((item) => item.step === step) ?? null;

  if (!policy) return null;
  if (policy.shouldRequest && !policy.shouldRequest(request)) {
    return null;
  }

  return policy;
}

export async function applyApprovalPolicy<TRequest, TData, TStep extends string>(
  definition: WorkflowDefinition<TRequest, unknown, TStep>,
  runtime: WorkflowRuntime<TStep>,
  params: {
    request: TRequest;
    step: TStep;
    data: TData;
  }
): Promise<void> {
  const policy = getApprovalPolicy(definition, params.step, params.request);
  if (!policy) return;

  const approval = policy.buildApproval({
    request: params.request,
    data: params.data,
  });

  if (policy.buildCheckpoint) {
    runtime.setCheckpoint(
      policy.buildCheckpoint({
        request: params.request,
        data: params.data,
      })
    );
  }

  await runtime.requestApproval({
    step: policy.step,
    riskLevel: policy.riskLevel,
    title: approval.title,
    summary: approval.summary,
  });
}
