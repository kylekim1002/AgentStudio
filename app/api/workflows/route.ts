import { NextRequest, NextResponse } from "next/server";
import { listWorkflowDefinitions } from "@/lib/workflows/core/registry";
import { registerBuiltinWorkflows } from "@/lib/workflows/registerBuiltins";

export async function GET(req: NextRequest) {
  registerBuiltinWorkflows();
  const { searchParams } = new URL(req.url);
  const includeMetadata = searchParams.get("include") === "metadata";
  const workflows = listWorkflowDefinitions();

  return NextResponse.json({
    workflows: includeMetadata
      ? workflows.map((name) => ({ name }))
      : workflows,
  });
}
