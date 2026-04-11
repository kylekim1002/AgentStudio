import { RiskLevel } from "./types";

export function classifyRiskLevel(workflow: string, _input: unknown): RiskLevel {
  if (workflow === "lesson_generation") {
    return "safe";
  }
  return "review";
}
