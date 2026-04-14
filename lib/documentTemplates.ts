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

export type TemplateCanvasItemType =
  | "section"
  | "text"
  | "image";

export type TemplateFontPreset =
  | "system-sans"
  | "korean-gothic"
  | "serif"
  | "mono";

export const TEMPLATE_FONT_OPTIONS: Array<{
  value: TemplateFontPreset;
  label: string;
  webFamily: string;
  pdfFamily: "Helvetica" | "Times-Roman" | "Courier";
  pdfBoldFamily: string;
  pdfItalicFamily: string;
  pdfBoldItalicFamily: string;
}> = [
  {
    value: "system-sans",
    label: "기본 산세리프",
    webFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    pdfFamily: "Helvetica",
    pdfBoldFamily: "Helvetica-Bold",
    pdfItalicFamily: "Helvetica-Oblique",
    pdfBoldItalicFamily: "Helvetica-BoldOblique",
  },
  {
    value: "korean-gothic",
    label: "고딕체",
    webFamily: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
    pdfFamily: "Helvetica",
    pdfBoldFamily: "Helvetica-Bold",
    pdfItalicFamily: "Helvetica-Oblique",
    pdfBoldItalicFamily: "Helvetica-BoldOblique",
  },
  {
    value: "serif",
    label: "명조체",
    webFamily: 'Georgia, "Times New Roman", serif',
    pdfFamily: "Times-Roman",
    pdfBoldFamily: "Times-Bold",
    pdfItalicFamily: "Times-Italic",
    pdfBoldItalicFamily: "Times-BoldItalic",
  },
  {
    value: "mono",
    label: "고정폭",
    webFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    pdfFamily: "Courier",
    pdfBoldFamily: "Courier-Bold",
    pdfItalicFamily: "Courier-Oblique",
    pdfBoldItalicFamily: "Courier-BoldOblique",
  },
];

export const DEFAULT_TEMPLATE_TEXT_STYLE = {
  fontFamily: "system-sans" as TemplateFontPreset,
  fontSize: 12,
  fontColor: "#334155",
  highlightColor: null as string | null,
  bold: false,
  italic: false,
  underline: false,
};

export const DEFAULT_TEMPLATE_SECTION_COUNTS = {
  reading: 5,
  vocabulary: 8,
  grammar: 8,
  assessment: 10,
} as const;

export interface DocumentTemplateBlock {
  id: string;
  type: TemplateBlockType;
  label: string;
  enabled: boolean;
}

export interface TemplateCanvasItem {
  id: string;
  type: TemplateCanvasItemType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sectionKey?: DocumentSectionKey;
  sectionItemLimit?: number | null;
  textContent?: string;
  imagePromptPresetId?: string | null;
  imagePromptText?: string;
  imageBindingIndex?: number | null;
  imageBindingId?: string | null;
  fontFamily?: TemplateFontPreset;
  fontSize?: number;
  fontColor?: string;
  highlightColor?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  locked?: boolean;
}

export function getTemplateFontOption(value?: string | null) {
  return TEMPLATE_FONT_OPTIONS.find((option) => option.value === value) ?? TEMPLATE_FONT_OPTIONS[0];
}

export interface TemplateCanvasPage {
  id: string;
  name: string;
  items: TemplateCanvasItem[];
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  previewLabel: string;
  pageSize: "A4";
  layout: "simple" | "advanced" | "canvas";
  accentColor: string;
  visibleSections: DocumentSectionKey[];
  blocks: DocumentTemplateBlock[];
  pages: TemplateCanvasPage[];
  createdAt?: string;
  updatedAt?: string;
}

export const AUTO_DOCUMENT_TEMPLATE_ID = "auto-template";

const SECTION_KEYS: DocumentSectionKey[] = [
  "passage",
  "reading",
  "vocabulary",
  "grammar",
  "writing",
  "assessment",
];

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDefaultSectionItemLimit(sectionKey: DocumentSectionKey) {
  if (sectionKey === "reading") return DEFAULT_TEMPLATE_SECTION_COUNTS.reading;
  if (sectionKey === "vocabulary") return DEFAULT_TEMPLATE_SECTION_COUNTS.vocabulary;
  if (sectionKey === "grammar") return DEFAULT_TEMPLATE_SECTION_COUNTS.grammar;
  if (sectionKey === "assessment") return DEFAULT_TEMPLATE_SECTION_COUNTS.assessment;
  return null;
}

function createSectionItem(
  sectionKey: DocumentSectionKey,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number
): TemplateCanvasItem {
  return {
    id: createId("item"),
    type: "section",
    label,
    sectionKey,
    sectionItemLimit: getDefaultSectionItemLimit(sectionKey),
    x,
    y,
    w,
    h,
    fontFamily: DEFAULT_TEMPLATE_TEXT_STYLE.fontFamily,
    fontSize: DEFAULT_TEMPLATE_TEXT_STYLE.fontSize,
    fontColor: DEFAULT_TEMPLATE_TEXT_STYLE.fontColor,
    highlightColor: DEFAULT_TEMPLATE_TEXT_STYLE.highlightColor,
    bold: DEFAULT_TEMPLATE_TEXT_STYLE.bold,
    italic: DEFAULT_TEMPLATE_TEXT_STYLE.italic,
    underline: DEFAULT_TEMPLATE_TEXT_STYLE.underline,
  };
}

function createTextItem(label: string, textContent: string, x: number, y: number, w: number, h: number): TemplateCanvasItem {
  return {
    id: createId("item"),
    type: "text",
    label,
    textContent,
    x,
    y,
    w,
    h,
    fontFamily: DEFAULT_TEMPLATE_TEXT_STYLE.fontFamily,
    fontSize: DEFAULT_TEMPLATE_TEXT_STYLE.fontSize,
    fontColor: DEFAULT_TEMPLATE_TEXT_STYLE.fontColor,
    highlightColor: DEFAULT_TEMPLATE_TEXT_STYLE.highlightColor,
    bold: DEFAULT_TEMPLATE_TEXT_STYLE.bold,
    italic: DEFAULT_TEMPLATE_TEXT_STYLE.italic,
    underline: DEFAULT_TEMPLATE_TEXT_STYLE.underline,
  };
}

function createImageItem(label: string, x: number, y: number, w: number, h: number, imagePromptPresetId?: string | null): TemplateCanvasItem {
  return {
    id: createId("item"),
    type: "image",
    label,
    x,
    y,
    w,
    h,
    imagePromptPresetId: imagePromptPresetId ?? null,
    imagePromptText: "",
    imageBindingIndex: null,
    imageBindingId: null,
    fontFamily: DEFAULT_TEMPLATE_TEXT_STYLE.fontFamily,
    fontSize: DEFAULT_TEMPLATE_TEXT_STYLE.fontSize,
    fontColor: DEFAULT_TEMPLATE_TEXT_STYLE.fontColor,
    highlightColor: DEFAULT_TEMPLATE_TEXT_STYLE.highlightColor,
    bold: DEFAULT_TEMPLATE_TEXT_STYLE.bold,
    italic: DEFAULT_TEMPLATE_TEXT_STYLE.italic,
    underline: DEFAULT_TEMPLATE_TEXT_STYLE.underline,
  };
}

function createDefaultPages(templateId: string): TemplateCanvasPage[] {
  return [
    {
      id: `${templateId}-page-1`,
      name: "1페이지",
      items: [
        createTextItem("문서 제목", "제목 영역", 8, 8, 70, 10),
        createSectionItem("passage", "지문", 8, 22, 84, 86),
      ],
    },
    {
      id: `${templateId}-page-2`,
      name: "2페이지",
      items: [
        createSectionItem("reading", "독해", 8, 8, 40, 78),
        createSectionItem("vocabulary", "어휘", 52, 8, 40, 78),
        createSectionItem("grammar", "문법", 8, 90, 84, 34),
      ],
    },
    {
      id: `${templateId}-page-3`,
      name: "3페이지",
      items: [
        createSectionItem("writing", "쓰기", 8, 8, 84, 42),
        createSectionItem("assessment", "평가지", 8, 54, 84, 70),
      ],
    },
  ];
}

export const DEFAULT_DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "classic-workbook",
    name: "클래식 워크북",
    description: "지문과 문제를 안정적으로 배치한 기본 워크북 형식입니다.",
    previewLabel: "워크북",
    pageSize: "A4",
    layout: "canvas",
    accentColor: "#4F46E5",
    visibleSections: ["passage", "reading", "vocabulary", "grammar", "writing", "assessment"],
    blocks: [
      { id: "passage-text", type: "text", label: "지문 텍스트", enabled: true },
      { id: "reading-mc", type: "multiple_choice", label: "독해 객관식", enabled: true },
      { id: "assessment-short", type: "short_answer", label: "평가 주관식", enabled: true },
    ],
    pages: createDefaultPages("classic-workbook"),
  },
  {
    id: "exam-focus",
    name: "시험 대비형",
    description: "시험지처럼 지문, 독해, 평가를 밀도 있게 배치합니다.",
    previewLabel: "시험형",
    pageSize: "A4",
    layout: "canvas",
    accentColor: "#0F766E",
    visibleSections: ["passage", "reading", "assessment", "grammar"],
    blocks: [
      { id: "reading-mc", type: "multiple_choice", label: "독해 객관식", enabled: true },
      { id: "assessment-mix", type: "short_answer", label: "평가 혼합형", enabled: true },
      { id: "guide-text", type: "text", label: "지시문 텍스트", enabled: true },
    ],
    pages: [
      {
        id: "exam-focus-page-1",
        name: "1페이지",
        items: [
          createTextItem("시험지 헤더", "시험 대비 학습지", 8, 8, 84, 10),
          createSectionItem("passage", "지문", 8, 22, 84, 92),
        ],
      },
      {
        id: "exam-focus-page-2",
        name: "2페이지",
        items: [
          createSectionItem("reading", "독해", 8, 8, 40, 72),
          createSectionItem("assessment", "평가지", 52, 8, 40, 72),
          createSectionItem("grammar", "문법", 8, 84, 84, 40),
        ],
      },
    ],
  },
];

export const AUTO_DOCUMENT_TEMPLATE: DocumentTemplate = {
  id: AUTO_DOCUMENT_TEMPLATE_ID,
  name: "자동 템플릿",
  description: "템플릿을 직접 고르지 않고 기본 문서 레이아웃으로 생성합니다.",
  previewLabel: "자동",
  pageSize: "A4",
  layout: "simple",
  accentColor: "#4F46E5",
  visibleSections: ["passage", "reading", "vocabulary", "grammar", "writing", "assessment"],
  blocks: [],
  pages: [],
};

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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeCanvasItem(item: unknown, index: number): TemplateCanvasItem {
  const source = (item ?? {}) as Record<string, unknown>;
  const type =
    source.type === "section" ||
    source.type === "text" ||
    source.type === "image"
      ? source.type
      : "section";
  const sectionKey =
    typeof source.sectionKey === "string" && SECTION_KEYS.includes(source.sectionKey as DocumentSectionKey)
      ? (source.sectionKey as DocumentSectionKey)
      : undefined;

  const x = clampNumber(source.x, 8, 0, 210);
  const y = clampNumber(source.y, 8 + index * 8, 0, 297);
  const w = clampNumber(source.w, 40, 8, 210 - x);
  const h = clampNumber(source.h, 24, 6, 297 - y);

  return {
    id: typeof source.id === "string" && source.id ? source.id : `item-${index + 1}`,
    type,
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : sectionKey
          ? sectionKey
          : `아이템 ${index + 1}`,
    x,
    y,
    w,
    h,
    sectionKey,
    sectionItemLimit:
      type === "section" && sectionKey
        ? clampNumber(
            source.sectionItemLimit,
            getDefaultSectionItemLimit(sectionKey) ?? 1,
            1,
            30
          )
        : null,
    textContent: typeof source.textContent === "string" ? source.textContent : "",
    imagePromptPresetId:
      typeof source.imagePromptPresetId === "string" && source.imagePromptPresetId.trim()
        ? source.imagePromptPresetId.trim()
        : null,
    imagePromptText:
      typeof source.imagePromptText === "string" ? source.imagePromptText : "",
    imageBindingIndex:
      typeof source.imageBindingIndex === "number" && Number.isFinite(source.imageBindingIndex)
        ? Math.max(0, Math.floor(source.imageBindingIndex))
        : null,
    imageBindingId:
      typeof source.imageBindingId === "string" && source.imageBindingId.trim()
        ? source.imageBindingId.trim()
        : null,
    fontFamily:
      typeof source.fontFamily === "string" &&
      TEMPLATE_FONT_OPTIONS.some((option) => option.value === source.fontFamily)
        ? (source.fontFamily as TemplateFontPreset)
        : DEFAULT_TEMPLATE_TEXT_STYLE.fontFamily,
    fontSize: clampNumber(source.fontSize, DEFAULT_TEMPLATE_TEXT_STYLE.fontSize, 8, 48),
    fontColor:
      typeof source.fontColor === "string" && source.fontColor.trim()
        ? source.fontColor.trim()
        : DEFAULT_TEMPLATE_TEXT_STYLE.fontColor,
    highlightColor:
      typeof source.highlightColor === "string" && source.highlightColor.trim()
        ? source.highlightColor.trim()
        : null,
    bold: source.bold === true,
    italic: source.italic === true,
    underline: source.underline === true,
    locked: source.locked === true,
  };
}

function normalizeCanvasPage(page: unknown, index: number, templateId: string): TemplateCanvasPage {
  const source = (page ?? {}) as Record<string, unknown>;
  return {
    id:
      typeof source.id === "string" && source.id.trim()
        ? source.id.trim()
        : `${templateId}-page-${index + 1}`,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : `${index + 1}페이지`,
    items: Array.isArray(source.items)
      ? source.items.map((item, itemIndex) => normalizeCanvasItem(item, itemIndex))
      : [],
  };
}

function buildPagesFromLegacy(
  templateId: string,
  visibleSections: DocumentSectionKey[],
  blocks: DocumentTemplateBlock[]
): TemplateCanvasPage[] {
  const items: TemplateCanvasItem[] = [];
  let y = 8;

  items.push(createTextItem("문서 헤더", "제목 영역", 8, y, 84, 10));
  y += 14;

  for (const section of visibleSections) {
    items.push(
      createSectionItem(
        section,
        section,
        8,
        y,
        84,
        section === "passage" ? 48 : 26
      )
    );
    y += section === "passage" ? 52 : 30;
  }

  if (blocks.some((block) => block.type === "image" && block.enabled)) {
    items.push(createImageItem("이미지", 58, 8, 34, 24));
  }

  return [
    {
      id: `${templateId}-page-1`,
      name: "1페이지",
      items,
    },
  ];
}

function collectVisibleSections(pages: TemplateCanvasPage[], fallback: DocumentSectionKey[]) {
  const fromPages = pages.flatMap((page) =>
    page.items
      .map((item) => item.sectionKey)
      .filter((section): section is DocumentSectionKey => Boolean(section))
  );

  const unique = Array.from(new Set(fromPages)).filter((section) => SECTION_KEYS.includes(section));
  return unique.length > 0 ? unique : fallback;
}

export function normalizeDocumentTemplates(value: unknown): DocumentTemplate[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_DOCUMENT_TEMPLATES;
  }

  const templates: DocumentTemplate[] = value
    .map((item, index) => {
      const source = (item ?? {}) as Record<string, unknown>;
      const templateId =
        typeof source.id === "string" && source.id.trim()
          ? source.id.trim()
          : `template-${index + 1}`;
      const legacyVisibleSections = Array.isArray(source.visibleSections)
        ? source.visibleSections.filter((section): section is DocumentSectionKey =>
            SECTION_KEYS.includes(String(section) as DocumentSectionKey)
          )
        : DEFAULT_DOCUMENT_TEMPLATES[0].visibleSections;
      const blocks = Array.isArray(source.blocks)
        ? source.blocks.map((block, blockIndex) => normalizeBlock(block, blockIndex))
        : DEFAULT_DOCUMENT_TEMPLATES[0].blocks;
      const pages = Array.isArray(source.pages)
        ? source.pages.map((page, pageIndex) => normalizeCanvasPage(page, pageIndex, templateId))
        : buildPagesFromLegacy(templateId, legacyVisibleSections, blocks);
      const visibleSections = collectVisibleSections(
        pages,
        legacyVisibleSections.length > 0 ? legacyVisibleSections : DEFAULT_DOCUMENT_TEMPLATES[0].visibleSections
      );

      return {
        id: templateId,
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
        layout: (
          source.layout === "advanced" || source.layout === "simple" || source.layout === "canvas"
            ? source.layout
            : "canvas"
        ) as DocumentTemplate["layout"],
        accentColor:
          typeof source.accentColor === "string" && source.accentColor.trim()
            ? source.accentColor.trim()
            : "#4F46E5",
        visibleSections,
        blocks,
        pages,
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
  if (templateId === AUTO_DOCUMENT_TEMPLATE_ID) {
    return AUTO_DOCUMENT_TEMPLATE;
  }
  const normalizedTemplates = normalizeDocumentTemplates(templates);
  return (
    normalizedTemplates.find((template) => template.id === templateId) ??
    normalizedTemplates[0] ??
    AUTO_DOCUMENT_TEMPLATE
  );
}

export function getTemplateSuggestedContentCounts(template: DocumentTemplate) {
  const sectionLimits = {
    reading: [] as number[],
    vocabulary: [] as number[],
    assessment: [] as number[],
    grammarExercises: [] as number[],
  };

  for (const page of template.pages) {
    for (const item of page.items) {
      if (item.type !== "section" || !item.sectionKey || !item.sectionItemLimit) continue;
      if (item.sectionKey === "reading") sectionLimits.reading.push(item.sectionItemLimit);
      if (item.sectionKey === "vocabulary") sectionLimits.vocabulary.push(item.sectionItemLimit);
      if (item.sectionKey === "assessment") sectionLimits.assessment.push(item.sectionItemLimit);
      if (item.sectionKey === "grammar") sectionLimits.grammarExercises.push(item.sectionItemLimit);
    }
  }

  function resolveSuggestedCount(limits: number[], defaultCount: number) {
    if (limits.length === 0) return defaultCount;
    if (limits.length === 1) return limits[0];

    // If the same default-sized section block was duplicated for layout purposes,
    // keep the recommended generation count at the default instead of multiplying it.
    const allDefaultSized = limits.every((limit) => limit === defaultCount);
    if (allDefaultSized) return defaultCount;

    return limits.reduce((sum, limit) => sum + limit, 0);
  }

  return {
    reading: resolveSuggestedCount(sectionLimits.reading, DEFAULT_TEMPLATE_SECTION_COUNTS.reading),
    vocabulary: resolveSuggestedCount(sectionLimits.vocabulary, DEFAULT_TEMPLATE_SECTION_COUNTS.vocabulary),
    assessment: resolveSuggestedCount(sectionLimits.assessment, DEFAULT_TEMPLATE_SECTION_COUNTS.assessment),
    grammarExercises: resolveSuggestedCount(sectionLimits.grammarExercises, DEFAULT_TEMPLATE_SECTION_COUNTS.grammar),
  };
}
