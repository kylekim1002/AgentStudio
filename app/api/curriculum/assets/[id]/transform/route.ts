import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function buildTransformPrompt(asset: {
  title: string;
  semester: string;
  level_name: string;
  subject: string;
  content_type: string;
  lexile_min: number | null;
  lexile_max: number | null;
}) {
  return `
당신은 영어 학원 커리큘럼 자료를 분석해서 구조화하는 도우미입니다.
반드시 JSON만 반환하세요.

자료 메타:
- 제목: ${asset.title}
- 학기: ${asset.semester}
- 레벨: ${asset.level_name}
- 과목: ${asset.subject}
- 유형: ${asset.content_type}
- Lexile: ${asset.lexile_min ?? "?"}L ~ ${asset.lexile_max ?? "?"}L

해야 할 일:
1. 이미지 안의 영어 지문/문항/정답/해설을 최대한 정확히 읽습니다.
2. 지문(passages), 문제세트(questionSets), 문제(questions)로 나눕니다.
3. 추측이 필요한 경우 metadata.notes에 불확실성을 남깁니다.

JSON 스키마:
{
  "pageText": "페이지 전체 추출 텍스트",
  "passages": [
    {
      "title": "지문 제목",
      "body": "지문 본문",
      "lexileMin": 0,
      "lexileMax": 0,
      "metadata": {}
    }
  ],
  "questionSets": [
    {
      "sectionType": "reading|vocabulary|grammar|writing|assessment",
      "questionStyle": "문항 스타일",
      "styleSummary": "스타일 요약",
      "passageIndex": 0,
      "questions": [
        {
          "questionType": "multiple_choice|short_answer|writing|other",
          "prompt": "문항 내용",
          "choices": ["A", "B"],
          "answer": "정답",
          "explanation": "해설",
          "metadata": {}
        }
      ]
    }
  ],
  "metadata": {
    "notes": "불확실성이나 해석 메모"
  }
}`;
}

type ParsedTransformResult = {
  pageText?: string;
  passages?: Array<{
    title?: string;
    body?: string;
    lexileMin?: number;
    lexileMax?: number;
    metadata?: Record<string, unknown>;
  }>;
  questionSets?: Array<{
    sectionType?: string;
    questionStyle?: string;
    styleSummary?: string;
    passageIndex?: number;
    questions?: Array<{
      questionType?: string;
      prompt?: string;
      choices?: string[];
      answer?: string;
      explanation?: string;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  metadata?: Record<string, unknown>;
};

async function parseStructuredJsonFromText(
  client: OpenAI,
  asset: {
    title: string;
    semester: string;
    level_name: string;
    subject: string;
    content_type: string;
    lexile_min: number | null;
    lexile_max: number | null;
  },
  extractedText: string
) {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildTransformPrompt(asset),
      },
      {
        role: "user",
        content: `아래 추출 텍스트를 읽고 커리큘럼 구조 JSON으로 변환해 주세요.\n\n${extractedText.slice(0, 40000)}`,
      },
    ],
  });

  return JSON.parse(response.choices[0]?.message?.content ?? "{}") as ParsedTransformResult;
}

async function persistStructuredResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  assetTitle: string,
  assetFileUrl: string,
  assetMetadata: Record<string, unknown> | null,
  parsed: ParsedTransformResult
) {
  await supabase.from("curriculum_asset_pages").delete().eq("asset_id", assetId);
  const existingSetIds =
    (
      await supabase
        .from("curriculum_question_sets")
        .select("id")
        .eq("asset_id", assetId)
    ).data?.map((row) => row.id) ?? [];
  if (existingSetIds.length) {
    await supabase.from("curriculum_questions").delete().in("question_set_id", existingSetIds);
  }
  await supabase.from("curriculum_question_sets").delete().eq("asset_id", assetId);
  await supabase.from("curriculum_passages").delete().eq("asset_id", assetId);

  await supabase.from("curriculum_asset_pages").insert({
    asset_id: assetId,
    page_number: 1,
    extracted_text: parsed.pageText ?? null,
    preview_image_url: assetFileUrl,
  });

  const insertedPassages: Array<{ id: string }> = [];
  for (const passage of parsed.passages ?? []) {
    if (!passage.body?.trim()) continue;
    const { data: inserted } = await supabase
      .from("curriculum_passages")
      .insert({
        asset_id: assetId,
        title: passage.title?.trim() || assetTitle,
        body: passage.body.trim(),
        lexile_min: Number.isFinite(passage.lexileMin) ? passage.lexileMin : null,
        lexile_max: Number.isFinite(passage.lexileMax) ? passage.lexileMax : null,
        metadata: passage.metadata ?? {},
      })
      .select("id")
      .single();
    if (inserted) insertedPassages.push(inserted);
  }

  let totalQuestions = 0;
  for (const set of parsed.questionSets ?? []) {
    const questions = (set.questions ?? []).filter((item) => item.prompt?.trim());
    const { data: insertedSet } = await supabase
      .from("curriculum_question_sets")
      .insert({
        asset_id: assetId,
        passage_id:
          typeof set.passageIndex === "number" && insertedPassages[set.passageIndex]
            ? insertedPassages[set.passageIndex].id
            : null,
        section_type: set.sectionType?.trim() || "other",
        question_style: set.questionStyle?.trim() || null,
        item_count: questions.length,
        style_summary: set.styleSummary?.trim() || null,
        metadata: {},
      })
      .select("id")
      .single();

    if (!insertedSet) continue;
    for (const question of questions) {
      await supabase.from("curriculum_questions").insert({
        question_set_id: insertedSet.id,
        question_type: question.questionType?.trim() || "other",
        prompt: question.prompt!.trim(),
        choices: Array.isArray(question.choices) ? question.choices : [],
        answer: question.answer?.trim() || null,
        explanation: question.explanation?.trim() || null,
        metadata: question.metadata ?? {},
      });
      totalQuestions += 1;
    }
  }

  await supabase
    .from("curriculum_assets")
    .update({
      status: "review_needed",
      metadata: {
        ...(assetMetadata ?? {}),
        transformMetadata: parsed.metadata ?? {},
      },
    })
    .eq("id", assetId);

  return {
    passages: insertedPassages.length,
    questionSets: (parsed.questionSets ?? []).length,
    questions: totalQuestions,
  };
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assetId = params.id;
  const { data: asset, error: assetError } = await supabase
    .from("curriculum_assets")
    .select("*")
    .eq("id", assetId)
    .single();

  if (assetError || !asset) {
    return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: job, error: jobError } = await supabase
    .from("curriculum_transform_jobs")
    .insert({
      asset_id: assetId,
      status: "processing",
      provider: "gpt",
      model: "gpt-4o",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "변환 작업 생성 실패" }, { status: 500 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let parsed: ParsedTransformResult;
    if (asset.file_type.startsWith("image/")) {
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildTransformPrompt(asset),
          },
          {
            role: "user",
            content: [
              { type: "text", text: "이 이미지를 읽고 커리큘럼 구조 JSON으로 변환해 주세요." },
              { type: "image_url", image_url: { url: asset.file_url } },
            ],
          },
        ],
      });
      parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as ParsedTransformResult;
    } else if (asset.file_type === "application/pdf") {
      const fileRes = await fetch(asset.file_url);
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      const parser = new PDFParse({ data: fileBuffer });
      const parsedPdf = await parser.getText();
      await parser.destroy();
      parsed = await parseStructuredJsonFromText(client, asset, parsedPdf.text || "");
      parsed.pageText = parsed.pageText || parsedPdf.text || "";
    } else if (
      asset.file_type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const fileRes = await fetch(asset.file_url);
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      parsed = await parseStructuredJsonFromText(client, asset, result.value || "");
      parsed.pageText = parsed.pageText || result.value || "";
    } else {
      throw new Error("현재는 이미지, PDF, DOCX 파일만 자동 구조화를 지원합니다.");
    }

    const resultSummary = await persistStructuredResult(
      supabase,
      assetId,
      asset.title,
      asset.file_url,
      asset.metadata ?? {},
      parsed
    );

    await supabase
      .from("curriculum_transform_jobs")
      .update({
        status: "completed",
        result_summary: resultSummary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "구조화 변환 중 오류가 발생했습니다.";
    await supabase
      .from("curriculum_transform_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
