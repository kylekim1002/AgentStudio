export const CURRICULUM_BUCKET = "curriculum-assets";

export const CURRICULUM_SEMESTERS = [
  "1학기",
  "2학기",
  "여름특강",
  "겨울특강",
] as const;

export const CURRICULUM_SUBJECTS = [
  "Reading",
  "Vocabulary",
  "Grammar",
  "Writing",
  "Assessment",
] as const;

export const CURRICULUM_TYPES = [
  "지문",
  "독해",
  "어휘",
  "문법",
  "쓰기",
  "평가",
] as const;

export const CURRICULUM_ASSET_STATUSES = [
  "uploaded",
  "parsed",
  "structured",
  "review_needed",
  "approved",
  "archived",
] as const;

export const CURRICULUM_TRANSFORM_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type CurriculumAssetStatus = (typeof CURRICULUM_ASSET_STATUSES)[number];
export type CurriculumTransformStatus = (typeof CURRICULUM_TRANSFORM_STATUSES)[number];

export interface CurriculumAssetSummary {
  id: string;
  title: string;
  semester: string;
  levelName: string;
  subject: string;
  contentType: string;
  fileUrl: string;
  fileType: string;
  notes: string | null;
  status: CurriculumAssetStatus;
  lexileMin: number | null;
  lexileMax: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  passageCount: number;
  questionSetCount: number;
  questionCount: number;
  latestJobStatus: CurriculumTransformStatus | null;
  latestJobError: string | null;
}

export interface CurriculumPassageRecord {
  id: string;
  title: string;
  body: string;
  lexileMin: number | null;
  lexileMax: number | null;
}

export interface CurriculumAssetPageRecord {
  id: string;
  pageNumber: number;
  extractedText: string | null;
  previewImageUrl: string | null;
}

export interface CurriculumQuestionSetRecord {
  id: string;
  passageId: string | null;
  sectionType: string;
  questionStyle: string | null;
  itemCount: number;
  styleSummary: string | null;
}

export interface CurriculumQuestionRecord {
  id: string;
  questionSetId: string;
  questionType: string;
  prompt: string;
  choices: string[];
  answer: string | null;
  explanation: string | null;
}

export interface CurriculumAssetDetail extends CurriculumAssetSummary {
  pages: CurriculumAssetPageRecord[];
  passages: CurriculumPassageRecord[];
  questionSets: CurriculumQuestionSetRecord[];
  questions: CurriculumQuestionRecord[];
}

export interface CurriculumReferencePayload {
  assetId: string;
  title: string;
  semester: string;
  levelName: string;
  subject: string;
  contentType: string;
  lexileMin?: number | null;
  lexileMax?: number | null;
  passageSamples: Array<{
    title: string;
    body: string;
  }>;
  questionSetSamples: Array<{
    sectionType: string;
    questionStyle: string | null;
    styleSummary: string | null;
    questions: Array<{
      questionType: string;
      prompt: string;
      choices: string[];
      answer?: string | null;
    }>;
  }>;
}

export const CURRICULUM_PARTIAL_SECTION_TYPES = [
  "reading",
  "vocabulary",
  "grammar",
  "writing",
  "assessment",
] as const;

export type CurriculumPartialSectionType =
  (typeof CURRICULUM_PARTIAL_SECTION_TYPES)[number];

export interface CurriculumPartialValidation {
  passed: boolean;
  issues: string[];
  summary: string;
}

export function buildCurriculumReferenceText(reference: CurriculumReferencePayload | null) {
  if (!reference) return "";

  const passageText = reference.passageSamples
    .map(
      (passage, index) =>
        `[참고 지문 ${index + 1}] ${passage.title}\n${passage.body.slice(0, 1200)}`
    )
    .join("\n\n");

  const questionText = reference.questionSetSamples
    .map((set, index) => {
      const sampleQuestions = set.questions
        .slice(0, 5)
        .map((question, questionIndex) => {
          const choices = question.choices.length
            ? ` / 선택지: ${question.choices.join(" | ")}`
            : "";
          return `- 문항 ${questionIndex + 1}: ${question.prompt}${choices}`;
        })
        .join("\n");
      return `[참고 문제세트 ${index + 1}] ${set.sectionType} / 스타일: ${set.questionStyle ?? "미정"} / 요약: ${set.styleSummary ?? "없음"}\n${sampleQuestions}`;
    })
    .join("\n\n");

  return [
    "[커리큘럼 참고자료]",
    `자료명: ${reference.title}`,
    `분류: ${reference.semester} / ${reference.levelName} / ${reference.subject} / ${reference.contentType}`,
    `Lexile: ${reference.lexileMin ?? "?"}L ~ ${reference.lexileMax ?? "?"}L`,
    "이 자료의 지문 톤, 문제 스타일, 구성 방식을 참고하되 그대로 복사하지 말고 새로운 결과를 생성하세요.",
    passageText,
    questionText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeCurriculumFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
