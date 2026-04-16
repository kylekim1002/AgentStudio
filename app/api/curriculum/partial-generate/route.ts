import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { runLessonAgent } from "@/lib/workflows/lesson/runAgent";
import {
  AIProvider,
  AgentName,
  AssessmentOutput,
  DifficultyLevel,
  GrammarOutput,
  ReadingOutput,
  VocabularyOutput,
  WritingOutput,
  getWritingTasks,
} from "@/lib/workflows/lesson/types";
import {
  CurriculumPartialSectionType,
  CurriculumPartialValidation,
  CurriculumReferencePayload,
} from "@/lib/curriculum";

export const runtime = "nodejs";
export const maxDuration = 180;

const SECTION_AGENT_MAP: Record<CurriculumPartialSectionType, AgentName> = {
  reading: AgentName.READING,
  vocabulary: AgentName.VOCABULARY,
  grammar: AgentName.GRAMMAR,
  writing: AgentName.WRITING,
  assessment: AgentName.ASSESSMENT,
};

function clamp(n: unknown, min: number, max: number, fallback: number) {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function createValidation(summary: string, issues: string[]): CurriculumPartialValidation {
  return {
    passed: issues.length === 0,
    issues,
    summary,
  };
}

function validateReading(output: ReadingOutput, targetCount: number): CurriculumPartialValidation {
  const issues: string[] = [];
  if (output.questions.length !== targetCount) {
    issues.push(`독해 문항 수가 ${targetCount}개가 아닙니다.`);
  }
  output.questions.forEach((question, index) => {
    if (!question.question?.trim()) issues.push(`독해 ${index + 1}번의 질문이 비어 있습니다.`);
    if (!Array.isArray(question.options) || question.options.length !== 4) {
      issues.push(`독해 ${index + 1}번은 선택지가 4개여야 합니다.`);
    }
    if (!question.answer?.trim()) issues.push(`독해 ${index + 1}번의 정답이 비어 있습니다.`);
    if (!question.explanation?.trim()) issues.push(`독해 ${index + 1}번의 해설이 비어 있습니다.`);
  });
  return createValidation(
    issues.length === 0 ? "독해 문제 구조 검증을 통과했습니다." : "독해 문제 구조 검증에서 수정할 항목이 있습니다.",
    issues
  );
}

function validateVocabulary(output: VocabularyOutput, targetCount: number): CurriculumPartialValidation {
  const issues: string[] = [];
  if (output.words.length !== targetCount) {
    issues.push(`어휘 수가 ${targetCount}개가 아닙니다.`);
  }
  output.words.forEach((word, index) => {
    if (!word.word?.trim()) issues.push(`어휘 ${index + 1}번 단어가 비어 있습니다.`);
    if (!word.definition?.trim()) issues.push(`어휘 ${index + 1}번 definition이 비어 있습니다.`);
    if (!word.partOfSpeech?.trim()) issues.push(`어휘 ${index + 1}번 품사가 비어 있습니다.`);
    if (!word.exampleSentence?.trim()) issues.push(`어휘 ${index + 1}번 예문이 비어 있습니다.`);
    if (!word.koreanTranslation?.trim()) issues.push(`어휘 ${index + 1}번 한국어 번역이 비어 있습니다.`);
  });
  return createValidation(
    issues.length === 0 ? "어휘 자료 구조 검증을 통과했습니다." : "어휘 자료 구조 검증에서 수정할 항목이 있습니다.",
    issues
  );
}

function validateGrammar(output: GrammarOutput, targetCount: number): CurriculumPartialValidation {
  const issues: string[] = [];
  if (!output.focusPoint?.trim()) issues.push("문법 포인트가 비어 있습니다.");
  if (!output.explanation?.trim()) issues.push("문법 설명이 비어 있습니다.");
  if (!Array.isArray(output.examples) || output.examples.length < 3) {
    issues.push("문법 예문은 최소 3개가 필요합니다.");
  }
  const totalItems = (output.practiceExercises ?? []).reduce(
    (sum, exercise) => sum + exercise.items.length,
    0
  );
  if ((output.practiceExercises ?? []).length < 2) {
    issues.push("문법 연습은 2개 섹션으로 구성되어야 합니다.");
  }
  if (totalItems !== targetCount) {
    issues.push(`문법 문제 총 개수가 ${targetCount}개가 아닙니다.`);
  }
  output.practiceExercises.forEach((exercise, index) => {
    if (!exercise.instruction?.trim()) issues.push(`문법 연습 ${index + 1}번 안내가 비어 있습니다.`);
    if (exercise.items.length !== exercise.answers.length) {
      issues.push(`문법 연습 ${index + 1}번의 문항 수와 정답 수가 맞지 않습니다.`);
    }
  });
  return createValidation(
    issues.length === 0 ? "문법 문제 구조 검증을 통과했습니다." : "문법 문제 구조 검증에서 수정할 항목이 있습니다.",
    issues
  );
}

function validateWriting(output: WritingOutput, targetCount: number): CurriculumPartialValidation {
  const issues: string[] = [];
  const tasks = getWritingTasks(output);
  if (tasks.length !== targetCount) {
    issues.push(`쓰기 과제 수가 ${targetCount}개가 아닙니다.`);
  }
  tasks.forEach((task, index) => {
    if (!task.prompt?.trim()) issues.push(`쓰기 ${index + 1}번 prompt가 비어 있습니다.`);
    if (!Array.isArray(task.scaffolding) || task.scaffolding.length < 3) {
      issues.push(`쓰기 ${index + 1}번 scaffolding은 최소 3개가 필요합니다.`);
    }
    if (!Array.isArray(task.rubric) || task.rubric.length !== 4) {
      issues.push(`쓰기 ${index + 1}번 rubric은 4개 기준이 필요합니다.`);
    }
    if (!task.modelAnswer?.trim()) issues.push(`쓰기 ${index + 1}번 모범 답안이 비어 있습니다.`);
  });
  return createValidation(
    issues.length === 0 ? "쓰기 과제 구조 검증을 통과했습니다." : "쓰기 과제 구조 검증에서 수정할 항목이 있습니다.",
    issues
  );
}

function validateAssessment(output: AssessmentOutput, targetCount: number): CurriculumPartialValidation {
  const issues: string[] = [];
  if (output.questions.length !== targetCount) {
    issues.push(`평가 문항 수가 ${targetCount}개가 아닙니다.`);
  }
  const totalPoints = output.questions.reduce((sum, question) => sum + question.points, 0);
  const passingScore = Math.floor(totalPoints * 0.7);
  if (output.totalPoints !== totalPoints) {
    issues.push("평가지 totalPoints가 실제 문항 배점 합과 다릅니다.");
  }
  if (output.passingScore !== passingScore) {
    issues.push("평가지 passingScore가 총점의 70% 기준과 다릅니다.");
  }
  output.questions.forEach((question, index) => {
    if (!question.question?.trim()) issues.push(`평가 ${index + 1}번 질문이 비어 있습니다.`);
    if (!question.answer?.trim()) issues.push(`평가 ${index + 1}번 정답이 비어 있습니다.`);
    if (question.type === "multiple_choice" && (!question.options || question.options.length !== 4)) {
      issues.push(`평가 ${index + 1}번 객관식은 선택지 4개가 필요합니다.`);
    }
  });
  return createValidation(
    issues.length === 0 ? "평가지 구조 검증을 통과했습니다." : "평가지 구조 검증에서 수정할 항목이 있습니다.",
    issues
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("studio.generate")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    userInput?: string;
    provider?: AIProvider;
    sectionType?: CurriculumPartialSectionType;
    targetCount?: number;
    requestedLevelName?: string;
    requestedOfficialDifficulty?: string;
    requestedLexileMin?: number;
    requestedLexileMax?: number;
    difficulty?: DifficultyLevel;
    curriculumReference?: CurriculumReferencePayload | null;
  };

  if (!body.userInput?.trim()) {
    return Response.json({ error: "userInput is required" }, { status: 400 });
  }
  if (!body.curriculumReference) {
    return Response.json({ error: "curriculumReference is required" }, { status: 400 });
  }
  if (!body.sectionType || !(body.sectionType in SECTION_AGENT_MAP)) {
    return Response.json({ error: "sectionType is required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const apiKeys = (settings.apiKeys ?? {}) as {
    anthropic?: string;
    openai?: string;
    google?: string;
  };

  const passageSample =
    body.curriculumReference.passageSamples[0] ??
    (body.curriculumReference.questionSetSamples[0]
      ? {
          title: body.curriculumReference.title,
          body: body.curriculumReference.questionSetSamples[0].questions
            .map((question) => question.prompt)
            .join("\n"),
        }
      : null);

  if (!passageSample?.body?.trim()) {
    return Response.json({ error: "선택한 커리큘럼 자료에 참고할 지문이 없습니다." }, { status: 400 });
  }

  const targetCount = clamp(
    body.targetCount,
    1,
    body.sectionType === "writing" ? 10 : 30,
    body.sectionType === "writing" ? 1 : 5
  );
  const agentName = SECTION_AGENT_MAP[body.sectionType];
  const wordCount = passageSample.body
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;

  const input = {
    passage: {
      title: passageSample.title,
      passage: passageSample.body,
      wordCount,
      locked: true,
    },
    difficultyLock: {
      difficulty: body.difficulty ?? "elementary",
      officialDifficulty: body.requestedOfficialDifficulty,
      lexileMin: body.requestedLexileMin,
      lexileMax: body.requestedLexileMax,
      wordCountTarget: wordCount,
      vocabularyLevel: body.requestedOfficialDifficulty ?? body.difficulty ?? "elementary",
      locked: true,
    },
    teachingFrame: {
      gradeLevel: body.requestedLevelName ?? body.curriculumReference.levelName,
      targetSkills: [body.sectionType],
      lessonObjective: body.userInput,
    },
    targetCount,
    revisionInstruction: body.userInput,
  };

  try {
    let output:
      | ReadingOutput
      | VocabularyOutput
      | GrammarOutput
      | WritingOutput
      | AssessmentOutput;

    output = await runLessonAgent(
      agentName,
      body.provider ?? AIProvider.CLAUDE,
      input,
      {
        anthropic: typeof apiKeys.anthropic === "string" && apiKeys.anthropic ? apiKeys.anthropic : undefined,
        openai: typeof apiKeys.openai === "string" && apiKeys.openai ? apiKeys.openai : undefined,
        google: typeof apiKeys.google === "string" && apiKeys.google ? apiKeys.google : undefined,
      },
      {
        userId: user.id,
        workflow: "curriculum_partial_generation",
        endpoint: "curriculum.partial-generate",
        metadata: {
          sectionType: body.sectionType,
          curriculumAssetId: body.curriculumReference.assetId,
          curriculumTitle: body.curriculumReference.title,
        },
      }
    );

    const validation =
      body.sectionType === "reading"
        ? validateReading(output as ReadingOutput, targetCount)
        : body.sectionType === "vocabulary"
          ? validateVocabulary(output as VocabularyOutput, targetCount)
          : body.sectionType === "grammar"
            ? validateGrammar(output as GrammarOutput, targetCount)
            : body.sectionType === "writing"
              ? validateWriting(output as WritingOutput, targetCount)
              : validateAssessment(output as AssessmentOutput, targetCount);

    return Response.json({
      sectionType: body.sectionType,
      targetCount,
      output,
      validation,
      referenceTitle: body.curriculumReference.title,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "부분 보강 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
