import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_META } from "@/lib/agentMeta";
import { AgentName } from "@/lib/agents/types";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(agentName: AgentName): string {
  const meta = AGENT_META[agentName];
  if (!meta) return "당신은 레슨 생성 AI 에이전트입니다.";
  return `당신은 CYJ Jr Agent Studio의 "${meta.label}" 에이전트(${meta.num}번)입니다.

역할: ${meta.desc}

교사와 자연스럽게 대화하며 다음을 합니다:
- 자신의 역할과 작업 방식을 설명합니다
- 레슨 계획에 대한 전문적인 조언을 제공합니다
- 궁금한 점에 답변합니다
- 요청하면 예시 출력이나 작업 계획을 보여드립니다

규칙:
- 한국어로 간결하게 답변합니다 (2-4문장)
- 자신을 "${meta.label}"로 소개합니다
- 전문적이지만 친근한 톤을 유지합니다`;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { agentName, messages } = await req.json() as {
    agentName: AgentName;
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!agentName || !messages?.length) {
    return new Response(JSON.stringify({ error: "agentName and messages required" }), { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(agentName);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 512,
          system: systemPrompt,
          messages,
          stream: true,
        });

        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            );
          }
        }
        void logAIUsage({
          userId: user?.id,
          provider: "claude",
          model: "claude-opus-4-6",
          workflow: "agent_chat",
          agent: agentName,
          endpoint: "agent.messages",
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent chat failed";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
