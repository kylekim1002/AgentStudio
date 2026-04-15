import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { logAIUsage } from "@/lib/usage/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 120;

function buildPrompt({
  passage,
  title,
  prompt,
  revision,
}: {
  passage?: string;
  title?: string;
  prompt: string;
  revision?: string;
}) {
  const parts = [
    `Lesson title: ${title ?? "Untitled lesson"}`,
    passage ? `Passage excerpt:\n${passage.slice(0, 1600)}` : null,
    `Base prompt:\n${prompt}`,
    revision?.trim() ? `Revision request:\n${revision.trim()}` : null,
  ].filter(Boolean);

  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("studio.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    prompt?: string;
    revision?: string;
    passage?: string;
    title?: string;
    presetId?: string | null;
  };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "이미지 프롬프트가 필요합니다." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const apiKeys = (settings.apiKeys ?? {}) as Record<string, unknown>;
  const openaiApiKey =
    typeof apiKeys.openai === "string" && apiKeys.openai
      ? apiKeys.openai
      : process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return NextResponse.json(
      { error: "이미지 생성을 위한 OpenAI API 키가 설정되어 있지 않습니다." },
      { status: 400 }
    );
  }

  const client = new OpenAI({ apiKey: openaiApiKey });
  const finalPrompt = buildPrompt({
    title: body.title,
    passage: body.passage,
    prompt,
    revision: body.revision,
  });

  try {
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt: finalPrompt,
      size: "1536x1024",
    });

    const base64 = result.data?.[0]?.b64_json;
    if (!base64) {
      return NextResponse.json({ error: "이미지 생성 결과를 받지 못했습니다." }, { status: 502 });
    }

    void logAIUsage({
      userId: user.id,
      provider: "gpt",
      model: "gpt-image-1",
      workflow: "image_generation",
      agent: "image_prompt",
      endpoint: "images.generate",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      metadata: {
        presetId: body.presetId ?? null,
        title: body.title ?? null,
      },
    });

    return NextResponse.json({
      image: {
        id: `img-${Date.now()}`,
        url: `data:image/png;base64,${base64}`,
        prompt,
        presetId: body.presetId ?? null,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "이미지 생성 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
