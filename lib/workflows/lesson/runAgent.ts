import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { AIProvider, AgentName, ApiKeys } from "./types";
import { logAIUsage } from "@/lib/usage/aiUsage";

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;
let gemini: GoogleGenerativeAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getGemini(): GoogleGenerativeAI {
  if (!gemini) {
    gemini = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");
  }
  return gemini;
}

export function getApiKeyStatus(): {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
} {
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    google: Boolean(process.env.GOOGLE_API_KEY),
  };
}

function loadSystemPrompt(agentName: AgentName): string {
  const promptPath = path.join(process.cwd(), "prompts", `${agentName}.md`);
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, "utf-8");
  }
  return `You are the ${agentName}. Output only valid JSON with no markdown fences.`;
}

function extractJSON(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return JSON.parse(stripped);
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string
): Promise<{ text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const model = "claude-opus-4-6";
  const client = apiKey ? new Anthropic({ apiKey }) : getAnthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }
  return {
    text: block.text,
    model,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      totalTokens:
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  };
}

async function callGPT(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string
): Promise<{ text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const model = "gpt-4o";
  const client = apiKey ? new OpenAI({ apiKey }) : getOpenAI();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });
  return {
    text: response.choices[0].message.content ?? "{}",
    model,
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    },
  };
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string
): Promise<{ text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const client = apiKey ? new GoogleGenerativeAI(apiKey) : getGemini();
  const modelName = "gemini-1.5-pro";
  const modelClient = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });
  const result = await modelClient.generateContent(userMessage);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = (result.response as any).usageMetadata;
  return {
    text: result.response.text(),
    model: modelName,
    usage: {
      inputTokens: usage?.promptTokenCount,
      outputTokens: usage?.candidatesTokenCount,
      totalTokens: usage?.totalTokenCount,
    },
  };
}

export async function runLessonAgent<T = unknown>(
  agentName: AgentName,
  provider: AIProvider,
  input: unknown,
  apiKeys?: ApiKeys,
  context?: {
    userId?: string;
    workflow?: string;
    endpoint?: string;
    metadata?: {
      sessionId?: string | null;
      sessionTitle?: string | null;
      executionId?: string | null;
      [key: string]: unknown;
    };
  }
): Promise<T> {
  const systemPrompt = loadSystemPrompt(agentName);
  const userMessage = JSON.stringify(input, null, 2);

  let rawOutput: string;
  let modelName: string | undefined;
  let usage:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined;

  switch (provider) {
    case AIProvider.CLAUDE:
      {
        const response = await callClaude(systemPrompt, userMessage, apiKeys?.anthropic);
        rawOutput = response.text;
        modelName = response.model;
        usage = response.usage;
      }
      break;
    case AIProvider.GPT:
      {
        const response = await callGPT(systemPrompt, userMessage, apiKeys?.openai);
        rawOutput = response.text;
        modelName = response.model;
        usage = response.usage;
      }
      break;
    case AIProvider.GEMINI:
      {
        const response = await callGemini(systemPrompt, userMessage, apiKeys?.google);
        rawOutput = response.text;
        modelName = response.model;
        usage = response.usage;
      }
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  void logAIUsage({
    userId: context?.userId,
    provider,
    model: modelName ?? null,
    workflow: context?.workflow ?? "lesson_generation",
    agent: agentName,
    endpoint: context?.endpoint ?? "workflow",
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    metadata: context?.metadata,
  });

  try {
    return extractJSON(rawOutput) as T;
  } catch {
    throw new Error(
      `[${agentName}] JSON parse failed. Raw output:\n${rawOutput.slice(0, 500)}`
    );
  }
}
