import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, convertInchesToTwip, ImageRun, UnderlineType,
} from "docx";
import { LessonPackage } from "@/lib/agents/types";
import {
  DEFAULT_TEMPLATE_TEXT_STYLE,
  DocumentTemplate,
  TemplateCanvasItem,
  getTemplateFontOption,
} from "@/lib/documentTemplates";
import {
  applyTemplateContentLimits,
  getTemplateImageItems,
  renderCanvasTemplatePages,
  resolveTemplateImage,
} from "@/lib/documentTemplateRender";
import { getWritingTasks } from "@/lib/workflows/lesson/types";

type ExportType = "student" | "teacher";

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function body(text: string, bold = false) {
  return new Paragraph({ children: [new TextRun({ text, bold, size: 22 })], spacing: { after: 80 } });
}

function rule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 4 } },
    spacing: { before: 160, after: 160 },
    children: [],
  });
}

function dataUrlToUint8Array(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getDocxFontName(item?: Pick<TemplateCanvasItem, "fontFamily">) {
  const preset = item?.fontFamily ?? DEFAULT_TEMPLATE_TEXT_STYLE.fontFamily;
  if (preset === "serif") return "Times New Roman";
  if (preset === "mono") return "Consolas";
  return "Malgun Gothic";
}

function getDocxTextRun(text: string, item?: Pick<TemplateCanvasItem, "fontFamily" | "fontSize" | "fontColor" | "bold" | "italic" | "underline">) {
  return new TextRun({
    text,
    font: getDocxFontName(item),
    size: Math.max(16, Math.round((item?.fontSize ?? DEFAULT_TEMPLATE_TEXT_STYLE.fontSize) * 2)),
    color: item?.fontColor?.replace("#", "") ?? DEFAULT_TEMPLATE_TEXT_STYLE.fontColor.replace("#", ""),
    bold: item?.bold ?? false,
    italics: item?.italic ?? false,
    underline: item?.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function canvasBlockTitle(text: string, item: TemplateCanvasItem) {
  return new Paragraph({
    children: [getDocxTextRun(text, { ...item, bold: true })],
    spacing: { after: 80 },
  });
}

function canvasBlockBody(text: string, item: TemplateCanvasItem) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        new Paragraph({
          children: [getDocxTextRun(line, item)],
          spacing: { after: 40 },
        })
    );
}

async function buildCanvasDocxChildren(pkg: LessonPackage, isTeacher: boolean, template: DocumentTemplate) {
  const effectivePkg = applyTemplateContentLimits(pkg, template);
  const renderedPages = renderCanvasTemplatePages(template, effectivePkg, isTeacher);
  const children: (Paragraph | Table)[] = [];

  renderedPages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${pageIndex + 1}페이지`, bold: true, size: 20, color: "64748B" })],
        spacing: { after: 160 },
        alignment: AlignmentType.CENTER,
      })
    );

    const sortedItems = [...page.items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    sortedItems.forEach((item) => {
      const blockChildren: Paragraph[] = [canvasBlockTitle(item.label, item)];

      if (item.type === "image") {
        if (item.resolvedImage) {
          blockChildren.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: dataUrlToUint8Array(item.resolvedImage.url),
                  type: "png",
                  transformation: {
                    width: Math.max(180, Math.round(item.w * 4.2)),
                    height: Math.max(120, Math.round(item.h * 4.2)),
                  },
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [new TextRun({ text: item.resolvedImage.prompt, size: 16, color: "666666" })],
              spacing: { after: 20 },
            })
          );
        } else {
          blockChildren.push(
            new Paragraph({
              children: [getDocxTextRun("연결된 생성 이미지가 없습니다.", item)],
            })
          );
        }
      } else {
        blockChildren.push(...canvasBlockBody(item.renderedText || "내용 없음", item));
      }

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  children: blockChildren,
                  shading: {
                    fill: item.highlightColor?.replace("#", "") || (item.type === "image" ? "EFF6FF" : "F8FAFC"),
                  },
                  margins: {
                    top: 120,
                    bottom: 120,
                    left: 120,
                    right: 120,
                  },
                }),
              ],
            }),
          ],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: item.type === "image" ? "93C5FD" : "CBD5E1" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: item.type === "image" ? "93C5FD" : "CBD5E1" },
            left: { style: BorderStyle.SINGLE, size: 1, color: item.type === "image" ? "93C5FD" : "CBD5E1" },
            right: { style: BorderStyle.SINGLE, size: 1, color: item.type === "image" ? "93C5FD" : "CBD5E1" },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          },
        }),
        new Paragraph({ children: [], spacing: { after: 120 } })
      );
    });
  });

  return children;
}

export async function generateDocx(
  pkg: LessonPackage,
  type: ExportType,
  template: DocumentTemplate
): Promise<Blob> {
  const isTeacher = type === "teacher";
  if (template.layout === "canvas") {
    const children = await buildCanvasDocxChildren(pkg, isTeacher, template);
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.7),
              right: convertInchesToTwip(0.7),
            },
          },
        },
        children,
      }],
      styles: { default: { document: { run: { font: "Malgun Gothic", size: 22 } } } },
    });

    const buffer = await Packer.toBuffer(doc);
    return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  const effectivePkg = applyTemplateContentLimits(pkg, template);
  const writingTasks = getWritingTasks(effectivePkg.writing);
  const children: (Paragraph | Table)[] = [];
  const visible = new Set(template.visibleSections);

  // ── Cover ─────────────────────────────────────────────────
  children.push(
    new Paragraph({ children: [new TextRun({ text: effectivePkg.title, bold: true, size: 40 })], spacing: { after: 160 }, alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `난이도: ${effectivePkg.difficulty}  |  단어 수: ${effectivePkg.wordCount}`, size: 20, color: "666666" })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
  );

  const imageItems = getTemplateImageItems(template);
  if (imageItems.length > 0 && (effectivePkg.generatedImages?.length ?? 0) > 0) {
    children.push(heading("🖼️ 학습 이미지", HeadingLevel.HEADING_1));
    imageItems.forEach(({ item }, index) => {
      const image = resolveTemplateImage(template, effectivePkg, item.id);
      if (!image) return;
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: dataUrlToUint8Array(image.url),
              type: "png",
              transformation: {
                width: 480,
                height: 320,
              },
            }),
          ],
          spacing: { after: 100 },
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new TextRun({ text: `${index + 1}. ${image.prompt}`, size: 18, color: "666666" })],
          spacing: { after: 220 },
          alignment: AlignmentType.CENTER,
        })
      );
    });
    children.push(rule());
  }

  // ── Passage ────────────────────────────────────────────────
  if (visible.has("passage")) {
    children.push(heading("📖 지문 (Reading Passage)", HeadingLevel.HEADING_1));
    effectivePkg.passage.split("\n\n").forEach((para) => {
      if (para.trim()) children.push(body(para.trim()));
    });
    children.push(rule());
  }

  // ── Reading ────────────────────────────────────────────────
  if (visible.has("reading")) {
    children.push(heading("❓ 독해 문제 (Reading Questions)", HeadingLevel.HEADING_1));
    effectivePkg.reading.questions.forEach((q, i) => {
      children.push(body(`Q${i + 1}. ${q.question}`, false));
      q.options.forEach((opt, j) => {
        children.push(body(`  ${String.fromCharCode(65 + j)}. ${opt}`));
      });
      if (isTeacher) {
        children.push(body(`  ▶ 정답: ${q.answer}`, true));
        children.push(body(`  해설: ${q.explanation}`));
      }
      children.push(new Paragraph({ children: [], spacing: { after: 80 } }));
    });
    children.push(rule());
  }

  // ── Vocabulary ────────────────────────────────────────────
  if (visible.has("vocabulary")) {
    children.push(heading("📝 어휘 학습 (Vocabulary)", HeadingLevel.HEADING_1));
    const vocabRows = effectivePkg.vocabulary.words.map((w) =>
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: w.word, bold: true, size: 20 })] })], width: { size: 20, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: w.partOfSpeech, italics: true, size: 20, color: "888888" })] })], width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: w.definition, size: 20 })] })], width: { size: 40, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: w.koreanTranslation, size: 20 })] })], width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: isTeacher ? w.exampleSentence : "___________", size: 20 })] })], width: { size: 15, type: WidthType.PERCENTAGE } }),
      ],
    })
    );
    children.push(new Table({ rows: vocabRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(rule());
  }

  // ── Grammar ───────────────────────────────────────────────
  if (visible.has("grammar")) {
    children.push(heading("📐 문법 문제 (Grammar)", HeadingLevel.HEADING_1));
    children.push(body(effectivePkg.grammar.focusPoint, true));
    children.push(body(effectivePkg.grammar.explanation));
    if (effectivePkg.grammar.examples.length > 0) {
      children.push(body("예문:"));
      effectivePkg.grammar.examples.forEach((ex) => children.push(body(`  • ${ex}`)));
    }
    if (effectivePkg.grammar.practiceExercises.length > 0) {
      children.push(body("연습 문제:", true));
      effectivePkg.grammar.practiceExercises.forEach((ex, i) => {
        children.push(body(`${i + 1}. ${ex.instruction}`));
        ex.items.forEach((item) => children.push(body(`   ${item}`)));
        if (isTeacher) ex.answers.forEach((ans, j) => children.push(body(`   ▶ ${j + 1}. ${ans}`, true)));
      });
    }
    children.push(rule());
  }

  // ── Writing ───────────────────────────────────────────────
  if (visible.has("writing")) {
    children.push(heading("✍️ 쓰기 과제 (Writing)", HeadingLevel.HEADING_1));
    writingTasks.forEach((task, index) => {
      children.push(body(`쓰기 ${index + 1}. ${task.prompt}`, true));
      if (task.scaffolding.length > 0) {
        children.push(body("힌트:"));
        task.scaffolding.forEach((s) => children.push(body(`  • ${s}`)));
      }
      if (isTeacher && task.modelAnswer) {
        children.push(body("▶ 모범 답안:", true));
        children.push(body(task.modelAnswer));
      }
      if (task.rubric.length > 0) {
        children.push(body("채점 기준표:", true));
        task.rubric.forEach((r) => children.push(body(`  • ${r.criterion} (${r.maxPoints}점): ${r.description}`)));
      }
    });
    children.push(rule());
  }

  // ── Assessment ────────────────────────────────────────────
  if (visible.has("assessment")) {
    children.push(heading(`📊 평가지 (Assessment) — 총 ${effectivePkg.assessment.totalPoints}점`, HeadingLevel.HEADING_1));
    effectivePkg.assessment.questions.forEach((q, i) => {
      children.push(body(`Q${i + 1}. [${q.points}점] ${q.question}`, false));
      if (q.options) q.options.forEach((opt, j) => children.push(body(`   ${String.fromCharCode(65 + j)}. ${opt}`)));
      if (isTeacher) children.push(body(`   ▶ 정답: ${q.answer}`, true));
      children.push(new Paragraph({ children: [], spacing: { after: 60 } }));
    });
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) } } }, children }],
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 22 } } } },
  });

  const buffer = await Packer.toBuffer(doc);
  return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
