import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agents/runAgent";
import { AgentName, AIProvider, LessonPackage } from "@/lib/agents/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Parse @agent_name mentions from message, e.g. "@reading_agent"
function parseMentionedAgent(message: string): AgentName | null {
  const match = message.match(/@([a-z_]+)/);
  if (!match) return null;
  const candidate = match[1];
  return Object.values(AgentName).includes(candidate as AgentName)
    ? (candidate as AgentName)
    : null;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, provider, context } = body as {
    message?: string;
    provider?: string;
    context?: Partial<LessonPackage>;
  };

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const aiProvider = (provider as AIProvider) ?? AIProvider.CLAUDE;
  const mentionedAgent = parseMentionedAgent(message);

  if (!mentionedAgent) {
    return NextResponse.json(
      {
        error:
          "No agent mentioned. Use @agent_name syntax (e.g. @reading_agent) to target a specific agent.",
        availableAgents: Object.values(AgentName),
      },
      { status: 400 }
    );
  }

  // Build input: inject existing lesson context if provided
  const agentInput = {
    message,
    ...(context ? { lessonContext: context } : {}),
  };

  try {
    const output = await runAgent(mentionedAgent, aiProvider, agentInput);
    return NextResponse.json({
      agent: mentionedAgent,
      output,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Agent call failed";
    return NextResponse.json({ error }, { status: 500 });
  }
}
