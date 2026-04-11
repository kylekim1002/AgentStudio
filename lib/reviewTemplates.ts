export interface ReviewNoteTemplates {
  approved: string[];
  needs_revision: string[];
}

export const DEFAULT_REVIEW_NOTE_TEMPLATES: ReviewNoteTemplates = {
  approved: [
    "전체 흐름이 자연스럽고 바로 사용 가능합니다.",
    "난이도와 문항 구성이 적절해 승인합니다.",
  ],
  needs_revision: [
    "문항 표현을 조금 더 명확하게 다듬은 뒤 다시 요청해 주세요.",
    "어휘 설명과 문법 포인트 연결을 조금 더 보강해 주세요.",
  ],
};

function normalizeTemplateList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export function normalizeReviewNoteTemplates(value: unknown): ReviewNoteTemplates {
  if (!value || typeof value !== "object") {
    return DEFAULT_REVIEW_NOTE_TEMPLATES;
  }

  const source = value as Partial<Record<keyof ReviewNoteTemplates, unknown>>;
  return {
    approved: normalizeTemplateList(source.approved, DEFAULT_REVIEW_NOTE_TEMPLATES.approved),
    needs_revision: normalizeTemplateList(source.needs_revision, DEFAULT_REVIEW_NOTE_TEMPLATES.needs_revision),
  };
}
