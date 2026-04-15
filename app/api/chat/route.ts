import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";
import { AIProvider } from "@/lib/agents/types";
import { buildLevelContextText, LevelSetting } from "@/lib/levelSettings";

export const runtime = "nodejs";
export const maxDuration = 60;

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

type ChatMessage = { role: "user" | "assistant"; content: string };

function normalizeProvider(value: unknown): AIProvider {
  if (value === AIProvider.GPT || value === AIProvider.GEMINI || value === AIProvider.CLAUDE) {
    return value;
  }
  return AIProvider.CLAUDE;
}

async function loadChatProviderSettings(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .single();

  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const apiKeys = (settings.apiKeys ?? {}) as {
    anthropic?: string;
    openai?: string;
    google?: string;
  };

  const provider = normalizeProvider(settings.chatProvider ?? settings.defaultProvider);
  return { provider, apiKeys };
}

async function runClaudeChat(systemPrompt: string, messages: ChatMessage[], apiKey?: string) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 512,
    system: systemPrompt,
    messages,
    stream: true,
  });
  return response;
}

async function runGptChat(systemPrompt: string, messages: ChatMessage[], apiKey?: string) {
  const client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  });

  return {
    text: response.choices[0]?.message?.content ?? "",
    model: "gpt-4o",
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    },
  };
}

async function runGeminiChat(systemPrompt: string, messages: ChatMessage[], apiKey?: string) {
  const client = new GoogleGenerativeAI(apiKey || process.env.GOOGLE_API_KEY || "");
  const model = client.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: systemPrompt,
  });

  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const priorHistory = messages
    .slice(0, latestUserMessage ? -1 : messages.length)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const chat = model.startChat({ history: priorHistory });
  const result = await chat.sendMessage(latestUserMessage);
  const usage = (result.response as unknown as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  }).usageMetadata;

  return {
    text: result.response.text(),
    model: "gemini-1.5-pro",
    usage: {
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens: usage?.candidatesTokenCount ?? null,
      totalTokens: usage?.totalTokenCount ?? null,
    },
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { messages, sessionId, sessionTitle, levelProfile } = (await req.json()) as {
    messages: ChatMessage[];
    sessionId?: string;
    sessionTitle?: string;
    levelProfile?: LevelSetting | null;
  };

  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const levelContext = buildLevelContextText(levelProfile);
  const chatSystemPrompt = levelContext
    ? `${SYSTEM_PROMPT}\n\n현재 기본 레벨 설정:\n${levelContext}\n이 값은 대화 시작 시의 기본 기준이며, 교사와 대화하면서 더 세밀하게 조정할 수 있습니다.`
    : SYSTEM_PROMPT;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { provider, apiKeys } = user?.id
          ? await loadChatProviderSettings(user.id)
          : { provider: AIProvider.CLAUDE, apiKeys: {} };

        if (provider === AIProvider.CLAUDE) {
          const response = await runClaudeChat(chatSystemPrompt, messages, apiKeys.anthropic);
          let inputTokens: number | null = null;
          let outputTokens: number | null = null;

          for await (const event of response) {
            const usageCarrier = event as {
              type?: string;
              message?: { usage?: { input_tokens?: number; output_tokens?: number } };
              usage?: { input_tokens?: number; output_tokens?: number };
              delta?: { type?: string; text?: string };
            };

            if (usageCarrier.type === "message_start") {
              inputTokens = usageCarrier.message?.usage?.input_tokens ?? usageCarrier.usage?.input_tokens ?? inputTokens;
              outputTokens = usageCarrier.message?.usage?.output_tokens ?? usageCarrier.usage?.output_tokens ?? outputTokens;
            }

            if (usageCarrier.type === "message_delta") {
              outputTokens = usageCarrier.usage?.output_tokens ?? outputTokens;
            }

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
            provider: AIProvider.CLAUDE,
            model: "claude-opus-4-6",
            workflow: "studio_chat",
            endpoint: "chat.messages",
            inputTokens,
            outputTokens,
            totalTokens:
              inputTokens !== null || outputTokens !== null
                ? (inputTokens ?? 0) + (outputTokens ?? 0)
                : null,
            metadata: {
              sessionId: sessionId ?? null,
              sessionTitle: sessionTitle ?? null,
            },
          });
        } else {
          const response =
            provider === AIProvider.GPT
              ? await runGptChat(chatSystemPrompt, messages, apiKeys.openai)
              : await runGeminiChat(chatSystemPrompt, messages, apiKeys.google);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: response.text })}\n\n`)
          );

          void logAIUsage({
            userId: user?.id,
            provider,
            model: response.model,
            workflow: "studio_chat",
            endpoint: "chat.messages",
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens,
            metadata: {
              sessionId: sessionId ?? null,
              sessionTitle: sessionTitle ?? null,
            },
          });
        }

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
