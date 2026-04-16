import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { logAIUsage } from "@/lib/usage/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 120;
const GENERATED_IMAGE_BUCKET = "lesson-generated-images";

function buildPrompt({
  passage,
  title,
  prompt,
  revision,
  references,
}: {
  passage?: string;
  title?: string;
  prompt: string;
  revision?: string;
  references?: Array<{ name?: string; notes?: string }>;
}) {
  const parts = [
    `Lesson title: ${title ?? "Untitled lesson"}`,
    passage ? `Passage excerpt:\n${passage.slice(0, 1600)}` : null,
    `Base prompt:\n${prompt}`,
    references?.length
      ? `Reference guidance:\n${references
          .map(
            (reference, index) =>
              `${index + 1}. ${reference.name ?? `Reference ${index + 1}`}${
                reference.notes?.trim() ? ` — ${reference.notes.trim()}` : ""
              }`
          )
          .join("\n")}`
      : null,
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
    references?: Array<{
      id?: string;
      name?: string;
      url?: string;
      notes?: string;
    }>;
  };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "이미지 프롬프트가 필요합니다." }, { status: 400 });
  }

  const references = Array.isArray(body.references)
    ? body.references
        .map((reference) => ({
          id: typeof reference?.id === "string" ? reference.id : undefined,
          name: typeof reference?.name === "string" ? reference.name : undefined,
          url: typeof reference?.url === "string" ? reference.url.trim() : "",
          notes: typeof reference?.notes === "string" ? reference.notes : undefined,
        }))
        .filter((reference) => reference.url)
    : [];

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
    references,
  });

  async function loadReferenceFiles() {
    const files: File[] = [];
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      try {
        const response = await fetch(reference.url);
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") || "image/png";
        if (!contentType.startsWith("image/")) continue;
        const arrayBuffer = await response.arrayBuffer();
        const extension = contentType.split("/")[1] || "png";
        files.push(
          new File([arrayBuffer], `reference-${index + 1}.${extension}`, {
            type: contentType,
          })
        );
      } catch {
        continue;
      }
    }
    return files;
  }

  try {
    const referenceFiles = await loadReferenceFiles();
    const service = await createServiceClient();
    let result;
    if (referenceFiles.length > 0) {
      try {
        result = await client.images.edit({
          model: "gpt-image-1",
          prompt: finalPrompt,
          image: referenceFiles,
          size: "1536x1024",
        });
      } catch {
        result = await client.images.generate({
          model: "gpt-image-1",
          prompt: finalPrompt,
          size: "1536x1024",
        });
      }
    } else {
      result = await client.images.generate({
        model: "gpt-image-1",
        prompt: finalPrompt,
        size: "1536x1024",
      });
    }

    const base64 = result.data?.[0]?.b64_json;
    if (!base64) {
      return NextResponse.json({ error: "이미지 생성 결과를 받지 못했습니다." }, { status: 502 });
    }

    const imageId = `img-${Date.now()}`;
    const storagePath = `${user.id}/${imageId}.png`;
    const imageBuffer = Buffer.from(base64, "base64");
    const { error: uploadError } = await service.storage
      .from(GENERATED_IMAGE_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: publicUrlData } = service.storage
      .from(GENERATED_IMAGE_BUCKET)
      .getPublicUrl(storagePath);

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
        referenceCount: references.length,
      },
    });

    return NextResponse.json({
      image: {
        id: imageId,
        url: publicUrlData.publicUrl,
        storagePath,
        prompt,
        presetId: body.presetId ?? null,
        references,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error
        ? error.message
        : "이미지 생성 중 오류가 발생했습니다.";
    const message =
      rawMessage.includes("Cannot coerce the result to a single JSON object") ||
      rawMessage.includes("single JSON object")
        ? "참조 이미지 기반 생성에 실패했습니다. 프롬프트를 조금 단순하게 바꾸거나 참조 없이 다시 시도해 주세요."
        : rawMessage;
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
