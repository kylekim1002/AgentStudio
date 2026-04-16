import { DifficultyLevel } from "@/lib/agents/types";

export type OfficialDifficultyBandId =
  | "pre_a1"
  | "a1"
  | "a1_plus"
  | "a2"
  | "a2_plus"
  | "b1"
  | "b1_plus"
  | "b2"
  | "c1"
  | "c2";

export interface OfficialDifficultyBand {
  id: OfficialDifficultyBandId;
  label: string;
  description: string;
  internalDifficulty: DifficultyLevel;
}

export interface LevelSetting {
  id: string;
  name: string;
  difficultyBandId: OfficialDifficultyBandId;
  lexileMin: number;
  lexileMax: number;
  active?: boolean;
}

export const OFFICIAL_DIFFICULTY_BANDS: OfficialDifficultyBand[] = [
  { id: "pre_a1", label: "Pre-A1 (Starter)", description: "입문 이전 단계", internalDifficulty: "beginner" },
  { id: "a1", label: "CEFR A1 (Beginner)", description: "아주 쉬운 기초 단계", internalDifficulty: "beginner" },
  { id: "a1_plus", label: "CEFR A1+ (High Beginner)", description: "기초 확장 단계", internalDifficulty: "beginner" },
  { id: "a2", label: "CEFR A2 (Elementary)", description: "초급 학습자 단계", internalDifficulty: "elementary" },
  { id: "a2_plus", label: "CEFR A2+ (High Elementary)", description: "초급 후반 단계", internalDifficulty: "elementary" },
  { id: "b1", label: "CEFR B1 (Intermediate)", description: "중급 진입 단계", internalDifficulty: "intermediate" },
  { id: "b1_plus", label: "CEFR B1+ (High Intermediate)", description: "중급 후반 단계", internalDifficulty: "intermediate" },
  { id: "b2", label: "CEFR B2 (Upper-Intermediate)", description: "중상급 단계", internalDifficulty: "upper-intermediate" },
  { id: "c1", label: "CEFR C1 (Advanced)", description: "고급 단계", internalDifficulty: "advanced" },
  { id: "c2", label: "CEFR C2 (Proficient)", description: "매우 높은 고급 단계", internalDifficulty: "advanced" },
];

export const DEFAULT_LEVEL_SETTINGS: LevelSetting[] = [];

function createLevelId() {
  return `level-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLexileValue(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function normalizeDifficultyBandId(value: unknown): OfficialDifficultyBandId {
  const found = OFFICIAL_DIFFICULTY_BANDS.find((item) => item.id === value);
  return found?.id ?? "a1";
}

export function normalizeLevelSettings(input: unknown): LevelSetting[] {
  if (!Array.isArray(input)) return DEFAULT_LEVEL_SETTINGS;
  return input.reduce<LevelSetting[]>((acc, item, index) => {
      if (!item || typeof item !== "object") return acc;
      const source = item as Record<string, unknown>;
      const lexileMin = normalizeLexileValue(source.lexileMin, 0);
      const lexileMax = normalizeLexileValue(source.lexileMax, Math.max(lexileMin, 100));
      acc.push({
        id: typeof source.id === "string" && source.id ? source.id : createLevelId(),
        name:
          typeof source.name === "string" && source.name.trim()
            ? source.name.trim()
            : `레벨 ${index + 1}`,
        difficultyBandId: normalizeDifficultyBandId(source.difficultyBandId),
        lexileMin: Math.min(lexileMin, lexileMax),
        lexileMax: Math.max(lexileMin, lexileMax),
        active: typeof source.active === "boolean" ? source.active : true,
      });
      return acc;
    }, []);
}

export function createEmptyLevelSetting(index: number): LevelSetting {
  return {
    id: createLevelId(),
    name: `레벨 ${index + 1}`,
    difficultyBandId: "a1",
    lexileMin: 200,
    lexileMax: 300,
    active: true,
  };
}

export function getOfficialDifficultyBand(id: OfficialDifficultyBandId | string | null | undefined) {
  return OFFICIAL_DIFFICULTY_BANDS.find((item) => item.id === id) ?? OFFICIAL_DIFFICULTY_BANDS[0];
}

export function getLevelInternalDifficulty(level: LevelSetting | null | undefined): DifficultyLevel | undefined {
  if (!level) return undefined;
  return getOfficialDifficultyBand(level.difficultyBandId).internalDifficulty;
}

export function buildLevelContextText(level: LevelSetting | null | undefined) {
  if (!level) return "";
  const band = getOfficialDifficultyBand(level.difficultyBandId);
  return `선택된 레벨 설정: ${level.name} / 난이도 ${band.label} / Lexile ${level.lexileMin}L-${level.lexileMax}L`;
}
