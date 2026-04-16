import { OFFICIAL_DIFFICULTY_BANDS } from "@/lib/levelSettings";

export type CodeValueCategory =
  | "campus"
  | "position"
  | "grade"
  | "semester"
  | "level"
  | "subject"
  | "content_type"
  | "difficulty";

export interface CodeValueItem {
  id: string;
  code: string;
  label: string;
  linkedLevelIds?: string[];
}

export type CodeValueStore = Record<CodeValueCategory, CodeValueItem[]>;

export const CODE_VALUE_CATEGORY_OPTIONS: Array<{
  key: CodeValueCategory;
  label: string;
}> = [
  { key: "campus", label: "캠퍼스 코드값" },
  { key: "position", label: "직급 코드값" },
  { key: "grade", label: "학년 코드값" },
  { key: "semester", label: "학기 코드값" },
  { key: "level", label: "레벨 코드값" },
  { key: "subject", label: "과목 코드값" },
  { key: "content_type", label: "유형 코드값" },
  { key: "difficulty", label: "난이도 코드값" },
];

function createCodeValueId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_CODE_VALUES: CodeValueStore = {
  campus: [],
  position: [],
  grade: [],
  semester: [
    { id: createCodeValueId("semester"), code: "semester-1", label: "1학기", linkedLevelIds: [] },
    { id: createCodeValueId("semester"), code: "semester-2", label: "2학기", linkedLevelIds: [] },
    { id: createCodeValueId("semester"), code: "summer", label: "여름특강", linkedLevelIds: [] },
    { id: createCodeValueId("semester"), code: "winter", label: "겨울특강", linkedLevelIds: [] },
  ],
  level: [],
  subject: [
    { id: createCodeValueId("subject"), code: "reading", label: "Reading" },
    { id: createCodeValueId("subject"), code: "vocabulary", label: "Vocabulary" },
    { id: createCodeValueId("subject"), code: "grammar", label: "Grammar" },
    { id: createCodeValueId("subject"), code: "writing", label: "Writing" },
    { id: createCodeValueId("subject"), code: "assessment", label: "Assessment" },
  ],
  content_type: [
    { id: createCodeValueId("type"), code: "passage", label: "지문" },
    { id: createCodeValueId("type"), code: "reading", label: "독해" },
    { id: createCodeValueId("type"), code: "vocabulary", label: "어휘" },
    { id: createCodeValueId("type"), code: "grammar", label: "문법" },
    { id: createCodeValueId("type"), code: "writing", label: "쓰기" },
    { id: createCodeValueId("type"), code: "assessment", label: "평가" },
  ],
  difficulty: OFFICIAL_DIFFICULTY_BANDS.map((band) => ({
    id: createCodeValueId("difficulty"),
    code: band.id,
    label: band.label,
  })),
};

export function createEmptyCodeValue(category: CodeValueCategory, index: number): CodeValueItem {
  const baseLabel = `${CODE_VALUE_CATEGORY_OPTIONS.find((item) => item.key === category)?.label.replace(" 코드값", "") ?? "코드값"} ${index + 1}`;
  return {
    id: createCodeValueId(category),
    code: baseLabel,
    label: baseLabel,
    ...(category === "semester" ? { linkedLevelIds: [] } : {}),
  };
}

function normalizeCodeValueItem(
  category: CodeValueCategory,
  item: unknown,
  index: number
): CodeValueItem | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const label =
    typeof source.label === "string" && source.label.trim()
      ? source.label.trim()
      : typeof source.code === "string" && source.code.trim()
        ? source.code.trim()
        : `${CODE_VALUE_CATEGORY_OPTIONS.find((option) => option.key === category)?.label.replace(" 코드값", "") ?? "코드값"} ${index + 1}`;
  const code =
    typeof source.code === "string" && source.code.trim()
      ? source.code.trim()
      : label;

  return {
    id:
      typeof source.id === "string" && source.id.trim()
        ? source.id.trim()
        : createCodeValueId(category),
    code,
    label,
    ...(category === "semester"
      ? {
          linkedLevelIds: Array.isArray(source.linkedLevelIds)
            ? source.linkedLevelIds.filter((value): value is string => typeof value === "string")
            : [],
        }
      : {}),
  };
}

export function normalizeCodeValues(input: unknown): CodeValueStore {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next = {} as CodeValueStore;

  for (const category of CODE_VALUE_CATEGORY_OPTIONS.map((item) => item.key)) {
    const raw = source[category];
    const normalized = Array.isArray(raw)
      ? raw
          .map((item, index) => normalizeCodeValueItem(category, item, index))
          .filter((item): item is CodeValueItem => Boolean(item))
      : DEFAULT_CODE_VALUES[category];
    next[category] = normalized;
  }

  return next;
}

export function getCodeValueItems(
  store: CodeValueStore | null | undefined,
  category: CodeValueCategory
) {
  return store?.[category] ?? DEFAULT_CODE_VALUES[category];
}

export function getFilteredLevelCodeValues(
  store: CodeValueStore | null | undefined,
  semesterLabel: string | null | undefined
) {
  const levels = getCodeValueItems(store, "level");
  if (!semesterLabel) return levels;
  const semester = getCodeValueItems(store, "semester").find((item) => item.label === semesterLabel);
  if (!semester) return levels;
  if (!semester.linkedLevelIds || semester.linkedLevelIds.length === 0) return levels;
  return levels.filter((level) => semester.linkedLevelIds?.includes(level.id));
}
