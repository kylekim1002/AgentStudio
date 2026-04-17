export const CLAUDE_CHAT_MODEL = "claude-opus-4-6";
export const GPT_CHAT_MODEL = "gpt-4o";

export const GEMINI_MODEL_CANDIDATES = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
] as const;

export const GEMINI_PRIMARY_MODEL = GEMINI_MODEL_CANDIDATES[0];

function errorText(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

export function isGeminiModelAvailabilityError(error: unknown) {
  const message = errorText(error);
  return (
    message.includes("not found") ||
    message.includes("not supported") ||
    message.includes("generative") ||
    message.includes("generatecontent")
  );
}
