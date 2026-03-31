import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, convertInchesToTwip,
} from "docx";
import { LessonPackage } from "@/lib/agents/types";

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

export async function generateDocx(pkg: LessonPackage, type: ExportType): Promise<Blob> {
  const isTeacher = type === "teacher";
  const children: (Paragraph | Table)[] = [];

  // ── Cover ─────────────────────────────────────────────────
  children.push(
    new Paragraph({ children: [new TextRun({ text: pkg.title, bold: true, size: 40 })], spacing: { after: 160 }, alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `난이도: ${pkg.difficulty}  |  단어 수: ${pkg.wordCount}`, size: 20, color: "666666" })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
  );

  // ── Passage ────────────────────────────────────────────────
  children.push(heading("📖 지문 (Reading Passage)", HeadingLevel.HEADING_1));
  pkg.passage.split("\n\n").forEach((para) => {
    if (para.trim()) children.push(body(para.trim()));
  });
  children.push(rule());

  // ── Reading ────────────────────────────────────────────────
  children.push(heading("❓ 독해 문제 (Reading Questions)", HeadingLevel.HEADING_1));
  pkg.reading.questions.forEach((q, i) => {
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

  // ── Vocabulary ────────────────────────────────────────────
  children.push(heading("📝 어휘 학습 (Vocabulary)", HeadingLevel.HEADING_1));
  const vocabRows = pkg.vocabulary.words.map((w) =>
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

  // ── Grammar ───────────────────────────────────────────────
  children.push(heading("📐 문법 미니레슨 (Grammar)", HeadingLevel.HEADING_1));
  children.push(body(pkg.grammar.focusPoint, true));
  children.push(body(pkg.grammar.explanation));
  if (pkg.grammar.examples.length > 0) {
    children.push(body("예문:"));
    pkg.grammar.examples.forEach((ex) => children.push(body(`  • ${ex}`)));
  }
  if (pkg.grammar.practiceExercises.length > 0) {
    children.push(body("연습 문제:", true));
    pkg.grammar.practiceExercises.forEach((ex, i) => {
      children.push(body(`${i + 1}. ${ex.instruction}`));
      ex.items.forEach((item) => children.push(body(`   ${item}`)));
      if (isTeacher) ex.answers.forEach((ans, j) => children.push(body(`   ▶ ${j + 1}. ${ans}`, true)));
    });
  }
  children.push(rule());

  // ── Writing ───────────────────────────────────────────────
  children.push(heading("✍️ 쓰기 과제 (Writing)", HeadingLevel.HEADING_1));
  children.push(body(pkg.writing.prompt, true));
  if (pkg.writing.scaffolding.length > 0) {
    children.push(body("힌트:"));
    pkg.writing.scaffolding.forEach((s) => children.push(body(`  • ${s}`)));
  }
  if (isTeacher && pkg.writing.modelAnswer) {
    children.push(body("▶ 모범 답안:", true));
    children.push(body(pkg.writing.modelAnswer));
  }
  if (pkg.writing.rubric.length > 0) {
    children.push(body("채점 기준표:", true));
    pkg.writing.rubric.forEach((r) => children.push(body(`  • ${r.criterion} (${r.maxPoints}점): ${r.description}`)));
  }
  children.push(rule());

  // ── Assessment ────────────────────────────────────────────
  children.push(heading(`📊 평가지 (Assessment) — 총 ${pkg.assessment.totalPoints}점`, HeadingLevel.HEADING_1));
  pkg.assessment.questions.forEach((q, i) => {
    children.push(body(`Q${i + 1}. [${q.points}점] ${q.question}`, false));
    if (q.options) q.options.forEach((opt, j) => children.push(body(`   ${String.fromCharCode(65 + j)}. ${opt}`)));
    if (isTeacher) children.push(body(`   ▶ 정답: ${q.answer}`, true));
    children.push(new Paragraph({ children: [], spacing: { after: 60 } }));
  });

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) } } }, children }],
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 22 } } } },
  });

  const buffer = await Packer.toBuffer(doc);
  return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
