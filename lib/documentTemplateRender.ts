import { LessonPackage } from "@/lib/agents/types";
import {
  DocumentSectionKey,
  DocumentTemplate,
  TemplateCanvasItem,
  TemplateCanvasPage,
} from "@/lib/documentTemplates";

export interface ResolvedTemplateImage {
  id: string;
  prompt: string;
  presetId?: string | null;
  url: string;
  createdAt: string;
}

export interface RenderedCanvasItem extends TemplateCanvasItem {
  renderedText?: string;
  resolvedImage?: ResolvedTemplateImage | null;
}

export interface RenderedCanvasPage extends TemplateCanvasPage {
  items: RenderedCanvasItem[];
  isOverflow?: boolean;
}

export function getTemplateImageItems(template: DocumentTemplate) {
  return template.pages.flatMap((page) =>
    page.items
      .filter((item) => item.type === "image")
      .map((item) => ({ pageId: page.id, item }))
  );
}

export function resolveTemplateImage(
  template: DocumentTemplate,
  pkg: LessonPackage,
  itemId: string
): ResolvedTemplateImage | null {
  const images = pkg.generatedImages ?? [];
  if (images.length === 0) return null;
  const imageItems = getTemplateImageItems(template);
  const matchedItem = imageItems.find(({ item }) => item.id === itemId)?.item;
  if (matchedItem?.imageBindingId) {
    const boundImage = images.find((image) => image.id === matchedItem.imageBindingId);
    if (boundImage) return boundImage;
  }
  if (matchedItem && typeof matchedItem.imageBindingIndex === "number" && images[matchedItem.imageBindingIndex]) {
    return images[matchedItem.imageBindingIndex];
  }
  const imageIndex = imageItems.findIndex(({ item }) => item.id === itemId);
  if (imageIndex >= 0 && images[imageIndex]) return images[imageIndex];
  return images[0] ?? null;
}

export function getSectionContent(
  pkg: LessonPackage,
  key: DocumentSectionKey,
  isTeacher: boolean
) {
  switch (key) {
    case "passage":
      return pkg.passage;
    case "reading":
      return pkg.reading.questions
        .map((q, index) => {
          const options = q.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n");
          const teacherMeta = isTeacher ? `\n정답: ${q.answer}\n해설: ${q.explanation}` : "";
          return `Q${index + 1}. ${q.question}\n${options}${teacherMeta}`;
        })
        .join("\n\n");
    case "vocabulary":
      return pkg.vocabulary.words
        .map((word) => {
          const teacherMeta = isTeacher ? `\n예문: ${word.exampleSentence}` : "";
          return `${word.word} (${word.partOfSpeech})\n${word.definition}\n${word.koreanTranslation}${teacherMeta}`;
        })
        .join("\n\n");
    case "grammar":
      return [
        pkg.grammar.focusPoint,
        pkg.grammar.explanation,
        ...pkg.grammar.examples.map((example) => `• ${example}`),
      ].join("\n\n");
    case "writing":
      return [
        pkg.writing.prompt,
        ...pkg.writing.scaffolding.map((item) => `• ${item}`),
        ...(isTeacher && pkg.writing.modelAnswer ? [`모범 답안\n${pkg.writing.modelAnswer}`] : []),
      ].join("\n\n");
    case "assessment":
      return pkg.assessment.questions
        .map((q, index) => {
          const options = q.options?.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n") ?? "";
          const teacherMeta = isTeacher ? `\n정답: ${q.answer}` : "";
          return `Q${index + 1}. [${q.points}점] ${q.question}${options ? `\n${options}` : ""}${teacherMeta}`;
        })
        .join("\n\n");
    default:
      return "";
  }
}

export function getCanvasItemText(
  item: TemplateCanvasItem,
  pkg: LessonPackage,
  isTeacher: boolean
) {
  if (item.type === "text") {
    return item.textContent?.trim() || "";
  }

  if (item.type === "section" && item.sectionKey) {
    return getSectionContent(pkg, item.sectionKey, isTeacher);
  }

  return "";
}

export function getCanvasItemCharacterLimit(item: TemplateCanvasItem) {
  const density = item.type === "text" ? 3.6 : 2.8;
  return Math.max(120, Math.floor(item.w * item.h * density));
}

function splitTextIntoChunk(text: string, limit: number) {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= limit) {
    return { chunk: normalized, rest: "" };
  }

  const paragraphs = normalized.split("\n\n").filter(Boolean);
  if (paragraphs.length === 0) {
    return {
      chunk: normalized.slice(0, limit).trim(),
      rest: normalized.slice(limit).trim(),
    };
  }

  let chunk = "";
  let cursor = 0;

  while (cursor < paragraphs.length) {
    const candidate = chunk ? `${chunk}\n\n${paragraphs[cursor]}` : paragraphs[cursor];
    if (candidate.length > limit) {
      break;
    }
    chunk = candidate;
    cursor += 1;
  }

  if (!chunk) {
    return {
      chunk: normalized.slice(0, limit).trim(),
      rest: normalized.slice(limit).trim(),
    };
  }

  return {
    chunk,
    rest: paragraphs.slice(cursor).join("\n\n").trim(),
  };
}

export function truncateCanvasText(text: string, item: TemplateCanvasItem) {
  const limit = getCanvasItemCharacterLimit(item);
  const { chunk, rest } = splitTextIntoChunk(text, limit);
  if (!rest) return chunk;
  return `${chunk.trimEnd()}…`;
}

function getItemSourceKey(item: TemplateCanvasItem) {
  if (item.type === "section" && item.sectionKey) {
    return `section:${item.sectionKey}`;
  }
  if (item.type === "text") {
    return `text:${item.id}`;
  }
  return null;
}

export function renderCanvasTemplatePages(
  template: DocumentTemplate,
  pkg: LessonPackage,
  isTeacher: boolean
): RenderedCanvasPage[] {
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const OVERFLOW_MARGIN_X = 8;
  const OVERFLOW_MARGIN_Y = 8;
  const OVERFLOW_GAP_Y = 4;
  const remainingText = new Map<string, string>();
  const sourceOrder: string[] = [];
  const sourcePrototype = new Map<string, TemplateCanvasItem>();

  for (const page of template.pages) {
    for (const item of page.items) {
      const sourceKey = getItemSourceKey(item);
      if (!sourceKey) continue;
      if (!remainingText.has(sourceKey)) {
        remainingText.set(sourceKey, getCanvasItemText(item, pkg, isTeacher));
        sourceOrder.push(sourceKey);
        sourcePrototype.set(sourceKey, item);
      }
    }
  }

  const renderedPages: RenderedCanvasPage[] = template.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (item.type === "image") {
        return {
          ...item,
          resolvedImage: resolveTemplateImage(template, pkg, item.id),
        };
      }

      const sourceKey = getItemSourceKey(item);
      const currentText = sourceKey ? remainingText.get(sourceKey) ?? "" : "";
      const { chunk, rest } = splitTextIntoChunk(currentText, getCanvasItemCharacterLimit(item));
      if (sourceKey) remainingText.set(sourceKey, rest);

      return {
        ...item,
        renderedText: chunk,
      };
    }),
  }));

  let overflowPageIndex = 1;
  while (sourceOrder.some((key) => (remainingText.get(key) ?? "").trim().length > 0)) {
    const overflowItems: RenderedCanvasItem[] = [];
    let y = 8;

    for (const sourceKey of sourceOrder) {
      const rest = (remainingText.get(sourceKey) ?? "").trim();
      if (!rest) continue;

      const prototype = sourcePrototype.get(sourceKey);
      if (!prototype) continue;

      const overflowHeight = prototype.sectionKey === "passage" ? Math.max(prototype.h, 108) : Math.max(prototype.h, 34);
      const maxOverflowHeight = PAGE_HEIGHT_MM - OVERFLOW_MARGIN_Y - y;
      if (y + overflowHeight > PAGE_HEIGHT_MM - OVERFLOW_MARGIN_Y && overflowItems.length > 0) {
        break;
      }

      const overflowItem: TemplateCanvasItem = {
        ...prototype,
        id: `${prototype.id}-overflow-${overflowPageIndex}-${overflowItems.length + 1}`,
        label: `${prototype.label} (계속)`,
        x: OVERFLOW_MARGIN_X,
        y,
        w: PAGE_WIDTH_MM - OVERFLOW_MARGIN_X * 2,
        h: Math.min(overflowHeight, maxOverflowHeight),
      };

      const { chunk, rest: nextRest } = splitTextIntoChunk(rest, getCanvasItemCharacterLimit(overflowItem));
      remainingText.set(sourceKey, nextRest);
      overflowItems.push({
        ...overflowItem,
        renderedText: chunk,
      });
      y += overflowItem.h + OVERFLOW_GAP_Y;
    }

    renderedPages.push({
      id: `${template.id}-overflow-${overflowPageIndex}`,
      name: `자동 추가 ${overflowPageIndex}페이지`,
      items: overflowItems,
      isOverflow: true,
    });
    overflowPageIndex += 1;
  }

  return renderedPages;
}

export function canvasLayoutLabel(template: DocumentTemplate) {
  switch (template.layout) {
    case "advanced":
      return "고급";
    case "canvas":
      return "캔버스";
    default:
      return "심플";
  }
}
