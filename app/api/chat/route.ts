import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a friendly lesson planning assistant for a Korean English academy (영어 학원). Your job is to help teachers plan English lesson packages through natural conversation — NOT to generate the lesson yourself.

Your goals through conversation:
1. Understand what kind of lesson the teacher wants
2. Gather key details (grade/age level, difficulty, topic or provided passage, any specific goals)
3. Clarify anything ambiguous
4. When you have enough info, summarize clearly and tell the teacher to click "레슨 생성 시작" to begin

Difficulty levels: beginner / elementary / intermediate / upper-intermediate / advanced
Typical grade mappings: 초등 1-2학년=beginner, 3-4학년=elementary, 5-6학년=intermediate, 중학교=intermediate~upper-intermediate, 고등학교=advanced

Rules:
- Keep replies concise (2-4 sentences usually)
- Ask ONE clarifying question at a time if info is missing
- Use Korean naturally; English terms for difficulty/level are fine
- Do NOT generate the lesson content yourself — just plan it
- When ready, end your message with a line like: "준비됐으면 아래 버튼을 눌러 레슨 생성을 시작하세요! 🚀"`;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { messages, provider } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    provider?: string;
  };

  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages,
          stream: true,
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            );
          }
        }
        void logAIUsage({
          userId: user?.id,
          provider: "claude",
          model: "claude-opus-4-6",
          workflow: "studio_chat",
          endpoint: "chat.messages",
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Chat failed";
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
