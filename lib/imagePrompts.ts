export interface ImagePromptPreset {
  id: string;
  name: string;
  prompt: string;
}

export const DEFAULT_IMAGE_PROMPT_PRESETS: ImagePromptPreset[] = [
  {
    id: "storybook-soft",
    name: "스토리북 일러스트",
    prompt:
      "Create a warm educational storybook illustration for Korean English academy materials. Clean composition, soft lighting, child-safe mood, readable details, no text, no watermark.",
  },
  {
    id: "realistic-classroom",
    name: "리얼 클래스룸",
    prompt:
      "Create a realistic but polished classroom-style illustration for English lesson materials. Clear subject, natural colors, no text, no watermark, print-friendly composition.",
  },
];

function createId() {
  return `prompt-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeImagePromptPresets(value: unknown): ImagePromptPreset[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_IMAGE_PROMPT_PRESETS;
  }

  const presets = value
    .map((item, index) => {
      const source = (item ?? {}) as Record<string, unknown>;
      const name =
        typeof source.name === "string" && source.name.trim()
          ? source.name.trim()
          : `프롬프트 ${index + 1}`;
      const prompt =
        typeof source.prompt === "string" && source.prompt.trim()
          ? source.prompt.trim()
          : "";

      if (!prompt) return null;

      return {
        id:
          typeof source.id === "string" && source.id.trim()
            ? source.id.trim()
            : createId(),
        name,
        prompt,
      } satisfies ImagePromptPreset;
    })
    .filter((preset): preset is ImagePromptPreset => Boolean(preset));

  return presets.length > 0 ? presets : DEFAULT_IMAGE_PROMPT_PRESETS;
}

