export class ApprovalRequiredError extends Error {
  approvalId: string;
  executionId: string;
  workflow: string;

  constructor(params: {
    approvalId: string;
    executionId: string;
    workflow: string;
    message?: string;
  }) {
    super(params.message ?? "Approval required");
    this.name = "ApprovalRequiredError";
    this.approvalId = params.approvalId;
    this.executionId = params.executionId;
    this.workflow = params.workflow;
  }
}
