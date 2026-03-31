import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { AIProvider, AgentName } from "./types";

// ─── Clients (lazy init) ──────────────────────────────────────────────────────

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

// ─── System Prompt Loader ─────────────────────────────────────────────────────

function loadSystemPrompt(agentName: AgentName): string {
  const promptPath = path.join(
    process.cwd(),
    "prompts",
    `${agentName}.md`
  );
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, "utf-8");
  }
  return `You are the ${agentName}. Output only valid JSON with no markdown fences.`;
}

// ─── JSON Extractor ───────────────────────────────────────────────────────────

function extractJSON(raw: string): unknown {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return JSON.parse(stripped);
}

// ─── Provider Calls ───────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}

async function callGPT(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });
  return response.choices[0].message.content ?? "{}";
}

async function callGemini(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const model = getGemini().getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userMessage);
  return result.response.text();
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

export async function runAgent<T = unknown>(
  agentName: AgentName,
  provider: AIProvider,
  input: unknown
): Promise<T> {
  const systemPrompt = loadSystemPrompt(agentName);
  const userMessage = JSON.stringify(input, null, 2);

  let rawOutput: string;

  switch (provider) {
    case AIProvider.CLAUDE:
      rawOutput = await callClaude(systemPrompt, userMessage);
      break;
    case AIProvider.GPT:
      rawOutput = await callGPT(systemPrompt, userMessage);
      break;
    case AIProvider.GEMINI:
      rawOutput = await callGemini(systemPrompt, userMessage);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  try {
    return extractJSON(rawOutput) as T;
  } catch {
    throw new Error(
      `[${agentName}] JSON parse failed. Raw output:\n${rawOutput.slice(0, 500)}`
    );
  }
}
