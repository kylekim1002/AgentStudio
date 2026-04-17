import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";
import { AIProvider } from "@/lib/agents/types";
import { buildLevelContextText, LevelSetting } from "@/lib/levelSettings";
import {
  CLAUDE_CHAT_MODEL,
  GEMINI_MODEL_CANDIDATES,
  GPT_CHAT_MODEL,
  isGeminiModelAvailabilityError,
} from "@/lib/ai/providerModels";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the vice principal coordinator AI ("부원장 에이전트") for a Korean English academy (영어 학원).

핵심 원칙:
- 사용자(교사)가 최상위 권한자입니다.
- 당신은 총괄/조정/1차 검수 담당자이지 최종 결정권자가 아닙니다.
- 전문 에이전트들은 독립적인 부하직원이며, 당신도 그중 한 명입니다.
- 최종 승인, 방향 확정, 발행 여부는 반드시 사용자에게 다시 확인받아야 합니다.

대화 목표:
1. 어떤 레슨/수정/재시도가 필요한지 파악
2. 핵심 정보(학년/난이도/주제/지문/목표)를 정리
3. 실패가 있으면 왜 실패했는지 쉬운 한국어로 설명
4. 가장 작은 수정안부터 제안하고, 필요하면 재실행 범위를 제안
5. 준비가 끝나면 레슨 생성을 시작하도록 안내

Rules:
- 한국어로 간결하게 답변합니다 (보통 2~5문장)
- 정보가 부족하면 한 번에 질문 하나만 합니다
- 실패를 설명할 때는 "현재 상태 → 원인 → 추천 조치" 순서로 말합니다
- 레슨 본문/문항을 직접 완성본으로 생성하지 말고, 조정·요약·보고에 집중합니다
- 준비가 끝났을 때만 "준비됐으면 아래 버튼을 눌러 레슨 생성을 시작하세요! 🚀"로 마무리합니다`;

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
    model: CLAUDE_CHAT_MODEL,
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
    model: GPT_CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  });

  return {
    text: response.choices[0]?.message?.content ?? "",
    model: GPT_CHAT_MODEL,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    },
  };
}

async function runGeminiChat(systemPrompt: string, messages: ChatMessage[], apiKey?: string) {
  const client = new GoogleGenerativeAI(apiKey || process.env.GOOGLE_API_KEY || "");
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const priorHistory = messages
    .slice(0, latestUserMessage ? -1 : messages.length)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  let lastError: unknown = null;
  for (const modelName of GEMINI_MODEL_CANDIDATES) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
      });
      const chat = model.startChat({ history: priorHistory });
      const result = await chat.sendMessage(latestUserMessage);
      const usage = (result.response as unknown as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      }).usageMetadata;

      return {
        text: result.response.text(),
        model: modelName,
        usage: {
          inputTokens: usage?.promptTokenCount ?? null,
          outputTokens: usage?.candidatesTokenCount ?? null,
          totalTokens: usage?.totalTokenCount ?? null,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isGeminiModelAvailabilityError(error)) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini chat failed");
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
  let activeProvider: AIProvider = AIProvider.CLAUDE;
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
        activeProvider = provider;

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
            model: CLAUDE_CHAT_MODEL,
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
        const msg =
          err instanceof Error && err.message
            ? activeProvider === AIProvider.GEMINI
              ? "Gemini 호출에 실패했습니다. 설정된 Gemini API 키와 사용 가능한 모델을 확인해 주세요."
              : err.message
            : "Chat failed";
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
