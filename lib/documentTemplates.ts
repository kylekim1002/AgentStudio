export type DocumentSectionKey =
  | "passage"
  | "reading"
  | "vocabulary"
  | "grammar"
  | "writing"
  | "assessment";

export type TemplateBlockType =
  | "text"
  | "multiple_choice"
  | "short_answer"
  | "image";

export interface DocumentTemplateBlock {
  id: string;
  type: TemplateBlockType;
  label: string;
  enabled: boolean;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  previewLabel: string;
  pageSize: "A4";
  layout: "simple" | "advanced";
  accentColor: string;
  visibleSections: DocumentSectionKey[];
  blocks: DocumentTemplateBlock[];
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "classic-workbook",
    name: "클래식 워크북",
    description: "기본 학원 과제지 형태. 지문과 문제를 차분하게 배치합니다.",
    previewLabel: "워크북",
    pageSize: "A4",
    layout: "simple",
    accentColor: "#4F46E5",
    visibleSections: ["passage", "reading", "vocabulary", "grammar", "writing", "assessment"],
    blocks: [
      { id: "passage-text", type: "text", label: "지문 텍스트", enabled: true },
      { id: "reading-mc", type: "multiple_choice", label: "독해 객관식", enabled: true },
      { id: "assessment-short", type: "short_answer", label: "평가 주관식", enabled: true },
    ],
  },
  {
    id: "exam-focus",
    name: "시험 대비형",
    description: "평가지와 독해 중심으로 구성된 시험 대비 문서입니다.",
    previewLabel: "시험형",
    pageSize: "A4",
    layout: "advanced",
    accentColor: "#0F766E",
    visibleSections: ["passage", "reading", "assessment", "grammar"],
    blocks: [
      { id: "reading-mc", type: "multiple_choice", label: "독해 객관식", enabled: true },
      { id: "assessment-mix", type: "short_answer", label: "평가 혼합형", enabled: true },
      { id: "guide-text", type: "text", label: "지시문 텍스트", enabled: true },
    ],
  },
];

function normalizeBlock(block: unknown, index: number): DocumentTemplateBlock {
  const source = (block ?? {}) as Record<string, unknown>;
  const type =
    source.type === "text" ||
    source.type === "multiple_choice" ||
    source.type === "short_answer" ||
    source.type === "image"
      ? source.type
      : "text";

  return {
    id: typeof source.id === "string" && source.id ? source.id : `block-${index + 1}`,
    type,
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : `블록 ${index + 1}`,
    enabled: source.enabled !== false,
  };
}

export function normalizeDocumentTemplates(value: unknown): DocumentTemplate[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_DOCUMENT_TEMPLATES;
  }

  const templates: DocumentTemplate[] = value
    .map((item, index) => {
      const source = (item ?? {}) as Record<string, unknown>;
      const visibleSections = Array.isArray(source.visibleSections)
        ? source.visibleSections.filter((section): section is DocumentSectionKey =>
            ["passage", "reading", "vocabulary", "grammar", "writing", "assessment"].includes(
              String(section)
            )
          )
        : DEFAULT_DOCUMENT_TEMPLATES[0].visibleSections;

      return {
        id:
          typeof source.id === "string" && source.id.trim()
            ? source.id.trim()
            : `template-${index + 1}`,
        name:
          typeof source.name === "string" && source.name.trim()
            ? source.name.trim()
            : `템플릿 ${index + 1}`,
        description:
          typeof source.description === "string" ? source.description.trim() : "",
        previewLabel:
          typeof source.previewLabel === "string" && source.previewLabel.trim()
            ? source.previewLabel.trim()
            : "미리보기",
        pageSize: "A4" as const,
        layout: (source.layout === "advanced" ? "advanced" : "simple") as
          | "simple"
          | "advanced",
        accentColor:
          typeof source.accentColor === "string" && source.accentColor.trim()
            ? source.accentColor.trim()
            : "#4F46E5",
        visibleSections:
          visibleSections.length > 0 ? visibleSections : DEFAULT_DOCUMENT_TEMPLATES[0].visibleSections,
        blocks: Array.isArray(source.blocks)
          ? source.blocks.map((block, blockIndex) => normalizeBlock(block, blockIndex))
          : DEFAULT_DOCUMENT_TEMPLATES[0].blocks,
        createdAt:
          typeof source.createdAt === "string" ? source.createdAt : undefined,
        updatedAt:
          typeof source.updatedAt === "string" ? source.updatedAt : undefined,
      };
    })
    .filter((template) => template.name);

  return templates.length > 0 ? templates : DEFAULT_DOCUMENT_TEMPLATES;
}

export function resolveDocumentTemplate(
  templates: DocumentTemplate[],
  templateId?: string | null
): DocumentTemplate {
  return (
    templates.find((template) => template.id === templateId) ??
    templates[0] ??
    DEFAULT_DOCUMENT_TEMPLATES[0]
  );
}
