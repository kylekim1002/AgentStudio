import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { AGENT_META } from "@/lib/agentMeta";
import { AgentName, AIProvider } from "@/lib/agents/types";
import { buildLevelContextText, LevelSetting } from "@/lib/levelSettings";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

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
  return client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 512,
    system: systemPrompt,
    messages,
    stream: true,
  });
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
  const { agentName, messages, sessionId, sessionTitle, levelProfile } = (await req.json()) as {
    agentName: AgentName;
    messages: ChatMessage[];
    sessionId?: string;
    sessionTitle?: string;
    levelProfile?: LevelSetting | null;
  };

  if (!agentName || !messages?.length) {
    return new Response(JSON.stringify({ error: "agentName and messages required" }), { status: 400 });
  }

  const baseSystemPrompt = buildSystemPrompt(agentName);
  const levelContext = buildLevelContextText(levelProfile);
  const systemPrompt = levelContext
    ? `${baseSystemPrompt}\n\n현재 기본 레벨 설정:\n${levelContext}\n이 값은 대화 시작 시의 기본 기준이며, 교사와 대화하면서 더 세밀하게 조정할 수 있습니다.`
    : baseSystemPrompt;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { provider, apiKeys } = user?.id
          ? await loadChatProviderSettings(user.id)
          : { provider: AIProvider.CLAUDE, apiKeys: {} };

        if (provider === AIProvider.CLAUDE) {
          const response = await runClaudeChat(systemPrompt, messages, apiKeys.anthropic);
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

            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
              );
            }
          }

          void logAIUsage({
            userId: user?.id,
            provider: AIProvider.CLAUDE,
            model: "claude-opus-4-6",
            workflow: "agent_chat",
            agent: agentName,
            endpoint: "agent.messages",
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
              ? await runGptChat(systemPrompt, messages, apiKeys.openai)
              : await runGeminiChat(systemPrompt, messages, apiKeys.google);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: response.text })}\n\n`)
          );

          void logAIUsage({
            userId: user?.id,
            provider,
            model: response.model,
            workflow: "agent_chat",
            agent: agentName,
            endpoint: "agent.messages",
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
