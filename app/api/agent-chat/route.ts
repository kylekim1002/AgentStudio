import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { AGENT_META } from "@/lib/agentMeta";
import { AgentName, AIProvider } from "@/lib/agents/types";
import { buildLevelContextText, LevelSetting } from "@/lib/levelSettings";
import { createClient } from "@/lib/supabase/server";
import { logAIUsage } from "@/lib/usage/aiUsage";
import {
  CLAUDE_CHAT_MODEL,
  GEMINI_MODEL_CANDIDATES,
  GPT_CHAT_MODEL,
  isGeminiModelAvailabilityError,
} from "@/lib/ai/providerModels";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildVicePrincipalPrompt(): string {
  return `당신은 CYJ Jr Agent Studio의 "부원장 에이전트"입니다.

역할:
- 전체 진행 상황을 총괄하고 사용자에게 1차 보고합니다
- 실패 원인을 분석하고, 수정안과 재실행 범위를 제안합니다
- 특정 에이전트가 만든 결과를 요약하고, 필요하면 다음 액션을 추천합니다

중요한 원칙:
- 사용자(교사)가 최상위 권한자입니다
- 당신도 부하직원이며, 최종 확정/발행/강제 변경 권한은 없습니다
- 모든 전문 에이전트보다 사용자의 지시가 우선합니다
- 중요한 수정/재실행은 반드시 사용자 승인을 요청해야 합니다

응답 방식:
- 한국어로 간결하게 답변합니다
- 가능하면 "요약 / 원인 / 추천 조치" 순서로 정리합니다
- 필요하면 마지막 문장은 반드시 승인 질문으로 끝냅니다`;
}

function buildSystemPrompt(agentName: AgentName): string {
  if (agentName === AgentName.VICE_PRINCIPAL) {
    return buildVicePrincipalPrompt();
  }
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
    model: CLAUDE_CHAT_MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages,
    stream: true,
  });
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

  throw lastError instanceof Error ? lastError : new Error("Gemini agent chat failed");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = (await req.json()) as {
    agentName: AgentName;
    messages: ChatMessage[];
    sessionId?: string;
    sessionTitle?: string;
    levelProfile?: LevelSetting | null;
    provider?: AIProvider;
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    agentName,
    messages,
    sessionId,
    sessionTitle,
    levelProfile,
    provider: requestedProvider,
  } = body;

  if (!agentName || !messages?.length) {
    return new Response(JSON.stringify({ error: "agentName and messages required" }), { status: 400 });
  }

  const baseSystemPrompt = buildSystemPrompt(agentName);
  const levelContext = buildLevelContextText(levelProfile);
  const systemPrompt = levelContext
    ? `${baseSystemPrompt}\n\n현재 기본 레벨 설정:\n${levelContext}\n이 값은 대화 시작 시의 기본 기준이며, 교사와 대화하면서 더 세밀하게 조정할 수 있습니다.`
    : baseSystemPrompt;
  const encoder = new TextEncoder();
  let activeProvider: AIProvider = AIProvider.CLAUDE;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { provider: savedProvider, apiKeys } = user?.id
          ? await loadChatProviderSettings(user.id)
          : { provider: AIProvider.CLAUDE, apiKeys: {} };
        activeProvider = requestedProvider
          ? normalizeProvider(requestedProvider)
          : savedProvider;

        if (activeProvider === AIProvider.CLAUDE) {
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
            provider: activeProvider,
            model: CLAUDE_CHAT_MODEL,
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
            activeProvider === AIProvider.GPT
              ? await runGptChat(systemPrompt, messages, apiKeys.openai)
              : await runGeminiChat(systemPrompt, messages, apiKeys.google);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: response.text })}\n\n`)
          );

          void logAIUsage({
            userId: user?.id,
            provider: activeProvider,
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
        const msg =
          err instanceof Error && err.message
            ? activeProvider === AIProvider.GEMINI
              ? "Gemini 호출에 실패했습니다. 설정된 Gemini API 키와 사용 가능한 모델을 확인해 주세요."
              : err.message
            : "Agent chat failed";
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
