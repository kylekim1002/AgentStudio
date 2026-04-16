import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type EditablePassage = {
  id: string;
  title: string;
  body: string;
  lexileMin: number | null;
  lexileMax: number | null;
};

type EditableQuestionSet = {
  id: string;
  passageId: string | null;
  sectionType: string;
  questionStyle: string | null;
  itemCount: number;
  styleSummary: string | null;
};

type EditableQuestion = {
  id: string;
  questionSetId: string;
  questionType: string;
  prompt: string;
  choices: string[];
  answer: string | null;
  explanation: string | null;
};

async function getAuthorizedAsset(supabase: Awaited<ReturnType<typeof createClient>>, assetId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, asset: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: asset, error: assetError } = await supabase
    .from("curriculum_assets")
    .select("*")
    .eq("id", assetId)
    .single();

  if (assetError || !asset) {
    return {
      user,
      asset: null,
      error: NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  return { user, asset, error: null };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const auth = await getAuthorizedAsset(supabase, params.id);
  if (auth.error || !auth.asset) return auth.error!;

  const asset = auth.asset;
  const [pagesResult, passagesResult, questionSetsResult, questionsResult, jobsResult] = await Promise.all([
    supabase
      .from("curriculum_asset_pages")
      .select("*")
      .eq("asset_id", asset.id)
      .order("page_number", { ascending: true }),
    supabase
      .from("curriculum_passages")
      .select("*")
      .eq("asset_id", asset.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("curriculum_question_sets")
      .select("*")
      .eq("asset_id", asset.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("curriculum_question_sets")
      .select("id")
      .eq("asset_id", asset.id),
    supabase
      .from("curriculum_transform_jobs")
      .select("status, error_message")
      .eq("asset_id", asset.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const setIds = (questionsResult.data ?? []).map((row) => row.id);
  const { data: questions, error: questionError } = setIds.length
    ? await supabase
        .from("curriculum_questions")
        .select("*")
        .in("question_set_id", setIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (
    pagesResult.error ||
    passagesResult.error ||
    questionSetsResult.error ||
    questionsResult.error ||
    questionError
  ) {
    return NextResponse.json({ error: "상세 자료를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    asset: {
      id: asset.id,
      title: asset.title,
      semester: asset.semester,
      levelName: asset.level_name,
      subject: asset.subject,
      contentType: asset.content_type,
      fileUrl: asset.file_url,
      fileType: asset.file_type,
      notes: asset.notes,
      status: asset.status,
      lexileMin: asset.lexile_min,
      lexileMax: asset.lexile_max,
      metadata: asset.metadata ?? {},
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      pageCount: pagesResult.data?.length ?? 0,
      passageCount: passagesResult.data?.length ?? 0,
      questionSetCount: questionSetsResult.data?.length ?? 0,
      questionCount: questions?.length ?? 0,
      latestJobStatus: jobsResult.data?.status ?? null,
      latestJobError: jobsResult.data?.error_message ?? null,
      pages: (pagesResult.data ?? []).map((page) => ({
        id: page.id,
        pageNumber: page.page_number,
        extractedText: page.extracted_text,
        previewImageUrl: page.preview_image_url,
      })),
      passages: (passagesResult.data ?? []).map((passage) => ({
        id: passage.id,
        title: passage.title,
        body: passage.body,
        lexileMin: passage.lexile_min,
        lexileMax: passage.lexile_max,
      })),
      questionSets: (questionSetsResult.data ?? []).map((set) => ({
        id: set.id,
        passageId: set.passage_id,
        sectionType: set.section_type,
        questionStyle: set.question_style,
        itemCount: set.item_count,
        styleSummary: set.style_summary,
      })),
      questions: (questions ?? []).map((question) => ({
        id: question.id,
        questionSetId: question.question_set_id,
        questionType: question.question_type,
        prompt: question.prompt,
        choices: Array.isArray(question.choices) ? question.choices : [],
        answer: question.answer,
        explanation: question.explanation,
      })),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const auth = await getAuthorizedAsset(supabase, params.id);
  if (auth.error || !auth.asset || !auth.user) return auth.error!;

  if (auth.asset.user_id !== auth.user.id) {
    return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });
  }

  const body = (await req.json()) as {
    notes?: string | null;
    lexileMin?: number | null;
    lexileMax?: number | null;
    passages?: EditablePassage[];
    questionSets?: EditableQuestionSet[];
    questions?: EditableQuestion[];
  };

  const passages = Array.isArray(body.passages) ? body.passages : [];
  const questionSets = Array.isArray(body.questionSets) ? body.questionSets : [];
  const questions = Array.isArray(body.questions) ? body.questions : [];

  const { error: assetError } = await supabase
    .from("curriculum_assets")
    .update({
      notes: typeof body.notes === "string" ? body.notes : null,
      lexile_min: Number.isFinite(body.lexileMin) ? body.lexileMin : null,
      lexile_max: Number.isFinite(body.lexileMax) ? body.lexileMax : null,
      status: "review_needed",
    })
    .eq("id", auth.asset.id);

  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 });
  }

  const existingSetIds =
    (
      await supabase
        .from("curriculum_question_sets")
        .select("id")
        .eq("asset_id", auth.asset.id)
    ).data?.map((row) => row.id) ?? [];

  if (existingSetIds.length) {
    await supabase.from("curriculum_questions").delete().in("question_set_id", existingSetIds);
  }
  await supabase.from("curriculum_question_sets").delete().eq("asset_id", auth.asset.id);
  await supabase.from("curriculum_passages").delete().eq("asset_id", auth.asset.id);

  const insertedPassageIdBySourceId = new Map<string, string>();
  for (const passage of passages) {
    const bodyText = passage.body.trim();
    if (!bodyText) continue;
    const { data: insertedPassage, error: insertPassageError } = await supabase
      .from("curriculum_passages")
      .insert({
        asset_id: auth.asset.id,
        title: passage.title.trim() || auth.asset.title,
        body: bodyText,
        lexile_min: Number.isFinite(passage.lexileMin) ? passage.lexileMin : null,
        lexile_max: Number.isFinite(passage.lexileMax) ? passage.lexileMax : null,
        metadata: {},
      })
      .select("id")
      .single();

    if (insertPassageError || !insertedPassage) {
      return NextResponse.json({ error: insertPassageError?.message ?? "지문 저장에 실패했습니다." }, { status: 500 });
    }

    insertedPassageIdBySourceId.set(passage.id, insertedPassage.id);
  }

  const insertedSetIdBySourceId = new Map<string, string>();
  for (const set of questionSets) {
    const normalizedSectionType = set.sectionType.trim() || auth.asset.content_type.toLowerCase();
    const questionCount = questions.filter((question) => question.questionSetId === set.id && question.prompt.trim()).length;
    const { data: insertedSet, error: insertSetError } = await supabase
      .from("curriculum_question_sets")
      .insert({
        asset_id: auth.asset.id,
        passage_id: set.passageId ? insertedPassageIdBySourceId.get(set.passageId) ?? null : null,
        section_type: normalizedSectionType,
        question_style: set.questionStyle?.trim() || null,
        item_count: questionCount,
        style_summary: set.styleSummary?.trim() || null,
        metadata: {},
      })
      .select("id")
      .single();

    if (insertSetError || !insertedSet) {
      return NextResponse.json({ error: insertSetError?.message ?? "문제세트 저장에 실패했습니다." }, { status: 500 });
    }

    insertedSetIdBySourceId.set(set.id, insertedSet.id);
  }

  for (const question of questions) {
    const prompt = question.prompt.trim();
    const targetSetId = insertedSetIdBySourceId.get(question.questionSetId);
    if (!targetSetId || !prompt) continue;
    const { error: insertQuestionError } = await supabase
      .from("curriculum_questions")
      .insert({
        question_set_id: targetSetId,
        question_type: question.questionType.trim() || "other",
        prompt,
        choices: Array.isArray(question.choices) ? question.choices.filter(Boolean) : [],
        answer: question.answer?.trim() || null,
        explanation: question.explanation?.trim() || null,
        metadata: {},
      });

    if (insertQuestionError) {
      return NextResponse.json({ error: insertQuestionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
