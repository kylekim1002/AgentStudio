import { WorkflowDefinition } from "./types";

const workflowRegistry = new Map<string, WorkflowDefinition<unknown, unknown, string>>();

export function registerWorkflow<TRequest, TResult, TStep extends string>(
  definition: WorkflowDefinition<TRequest, TResult, TStep>
): WorkflowDefinition<TRequest, TResult, TStep> {
  workflowRegistry.set(
    definition.name,
    definition as WorkflowDefinition<unknown, unknown, string>
  );
  return definition;
}

export function getWorkflowDefinition(name: string) {
  return workflowRegistry.get(name);
}

export function listWorkflowDefinitions(): string[] {
  return Array.from(workflowRegistry.keys()).sort();
}
