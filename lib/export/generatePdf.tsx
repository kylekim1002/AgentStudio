import React from "react";
import {
  Document, Page, Text, View, StyleSheet, pdf, Font, Image,
} from "@react-pdf/renderer";
import { LessonPackage } from "@/lib/agents/types";
import { DEFAULT_TEMPLATE_TEXT_STYLE, DocumentTemplate, getTemplateFontOption, TemplateCanvasItem } from "@/lib/documentTemplates";
import {
  applyTemplateContentLimits,
  renderCanvasTemplatePages,
} from "@/lib/documentTemplateRender";
import { getWritingTasks } from "@/lib/workflows/lesson/types";

type ExportType  = "student" | "teacher";
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PDF_FONT_REGISTRY_KEY = "__cyj_pdf_font_registered__";
const PDF_SANS = "CYJAppleGothic";
const PDF_SANS_BOLD = "CYJAppleGothicBold";

if (!(globalThis as Record<string, unknown>)[PDF_FONT_REGISTRY_KEY]) {
  Font.register({ family: PDF_SANS, src: "/fonts/AppleGothic.ttf" });
  Font.register({ family: PDF_SANS_BOLD, src: "/fonts/AppleGothic.ttf" });
  (globalThis as Record<string, unknown>)[PDF_FONT_REGISTRY_KEY] = true;
}

// ─── Styles ───────────────────────────────────────────────────

const S = StyleSheet.create({
  page:       { fontFamily: PDF_SANS, fontSize: 10, color: "#0F172A", padding: "42 44 42 44", backgroundColor: "#FFFFFF" },
  pageAdv:    { fontFamily: PDF_SANS, fontSize: 10, color: "#0F172A", padding: "34 38 34 38", backgroundColor: "#FFFFFF" },

  coverKicker: { fontSize: 9, color: "#475569", textAlign: "center", marginBottom: 8, letterSpacing: 0.6 },
  coverTitle: { fontSize: 20, fontFamily: PDF_SANS_BOLD, marginBottom: 8, textAlign: "center", lineHeight: 1.35 },
  coverSub:   { fontSize: 10, color: "#64748B", textAlign: "center", marginBottom: 18, lineHeight: 1.45 },
  metaPanel:  { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, padding: "10 12", marginBottom: 18 },
  metaRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 10 },
  metaLabel:  { fontSize: 9, color: "#64748B" },
  metaValue:  { fontSize: 9, color: "#0F172A", fontFamily: PDF_SANS_BOLD },

  sectionHdr: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderLeftWidth: 4, padding: "7 10", borderRadius: 6, marginBottom: 10, marginTop: 16 },
  sectionHdrAdv: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderLeftWidth: 4, padding: "8 12", borderRadius: 6, marginBottom: 10, marginTop: 18 },
  sectionTitle: { fontFamily: PDF_SANS_BOLD, fontSize: 11, color: "#0F172A" },

  para:       { marginBottom: 7, lineHeight: 1.72 },
  bold:       { fontFamily: PDF_SANS_BOLD },
  muted:      { color: "#64748B" },
  answer:     { color: "#059669", fontFamily: PDF_SANS_BOLD },
  indent:     { marginLeft: 12, marginBottom: 5, lineHeight: 1.6 },
  questionBlock: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, padding: "10 12", marginBottom: 10 },
  paragraphBox: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, padding: "12 14", marginBottom: 12 },

  table:      { marginBottom: 10 },
  tableHdr:   { backgroundColor: "#F8FAFC", flexDirection: "row", borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  tableRow:   { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E2E8F0" },
  tableCell:  { padding: "5 7", flex: 1, fontSize: 9, lineHeight: 1.45 },
  tableCellHdr: { padding: "5 7", flex: 1, fontSize: 9, fontFamily: PDF_SANS_BOLD, color: "#334155" },

  rule:       { borderBottomWidth: 0.5, borderBottomColor: "#E2E8F0", marginVertical: 10 },

  row2:       { flexDirection: "row", gap: 12 },
  col:        { flex: 1 },
  badge:      { backgroundColor: "#F8FAFC", color: "#334155", fontSize: 8, padding: "3 8", borderRadius: 999, alignSelf: "flex-start", marginBottom: 4, borderWidth: 1, borderColor: "#E2E8F0", fontFamily: PDF_SANS_BOLD },
  passBg:     { backgroundColor: "#FFFFFF", padding: "12 14", borderRadius: 8, borderWidth: 1, borderColor: "#E2E8F0", marginBottom: 10 },
  canvasPage: { fontFamily: PDF_SANS, fontSize: 10, color: "#0F172A", padding: "20 20 20 20", backgroundColor: "#FFFFFF" },
  canvasBox: { position: "absolute", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 6, padding: 6, overflow: "hidden" },
  canvasItemLabel: { fontSize: 8, fontFamily: PDF_SANS_BOLD, marginBottom: 4, color: "#0F172A" },
  canvasItemText: { fontSize: 8, lineHeight: 1.35, color: "#334155" },
  canvasImage: { width: "100%", height: "100%", objectFit: "cover" },
  canvasPlaceholder: { fontSize: 8, color: "#64748B", lineHeight: 1.4 },
});

// ─── Helpers ──────────────────────────────────────────────────

function SectionHeader({ title, advanced, accentColor }: { title: string; advanced?: boolean; accentColor: string }) {
  return (
    <View style={[advanced ? S.sectionHdrAdv : S.sectionHdr, { borderLeftColor: accentColor }]}>
      <Text style={S.sectionTitle}>{title}</Text>
    </View>
  );
}

function Rule() { return <View style={S.rule} />; }

function mmToPoints(mm: number) {
  return (mm * 72) / 25.4;
}

function getCanvasPdfTextStyle(item: TemplateCanvasItem, fallbackColor: string) {
  const font = getTemplateFontOption(item.fontFamily);
  const useBold = item.bold === true;
  const useItalic = item.italic === true;
  const resolvedFontFamily = useBold && useItalic
    ? font.pdfBoldItalicFamily
    : useBold
      ? font.pdfBoldFamily
      : useItalic
        ? font.pdfItalicFamily
        : font.pdfFamily;

  return {
    fontFamily: resolvedFontFamily,
    fontSize: Math.max(7, (item.fontSize ?? DEFAULT_TEMPLATE_TEXT_STYLE.fontSize) * 0.72),
    color: item.fontColor || fallbackColor,
    backgroundColor: item.highlightColor || undefined,
    textDecoration: item.underline ? "underline" : "none",
  } as const;
}

function CanvasDoc({ pkg, isTeacher, template }: { pkg: LessonPackage; isTeacher: boolean; template: DocumentTemplate }) {
  const effectivePkg = applyTemplateContentLimits(pkg, template);
  const pageWidth = mmToPoints(210);
  const pageHeight = mmToPoints(297);
  const innerWidth = pageWidth - 40;
  const innerHeight = pageHeight - 40;
  const renderedPages = renderCanvasTemplatePages(template, effectivePkg, isTeacher);

  return (
    <Document>
      {renderedPages.map((page) => (
        <Page key={page.id} size="A4" style={S.canvasPage}>
          {page.items.map((item) => {
            return (
              <View
                key={item.id}
                style={[
                  S.canvasBox,
                  {
                    left: (item.x / PAGE_WIDTH_MM) * innerWidth,
                    top: (item.y / PAGE_HEIGHT_MM) * innerHeight,
                    width: (item.w / PAGE_WIDTH_MM) * innerWidth,
                    height: (item.h / PAGE_HEIGHT_MM) * innerHeight,
                    borderColor: item.type === "image" ? "#BFDBFE" : "#CBD5E1",
                    backgroundColor: item.type === "image" ? "#F8FAFC" : "#FFFFFF",
                  },
                ]}
              >
                <Text style={[S.canvasItemLabel, getCanvasPdfTextStyle(item, "#0F172A")]}>{item.label}</Text>
                {item.type === "image" ? (
                  item.resolvedImage ? (
                    <Image src={item.resolvedImage.url} style={S.canvasImage} />
                  ) : (
                    <Text style={[S.canvasPlaceholder, getCanvasPdfTextStyle(item, "#64748B")]}>연결된 이미지가 없습니다.</Text>
                  )
                ) : (
                  <Text style={[S.canvasItemText, getCanvasPdfTextStyle(item, "#334155")]}>{item.renderedText || "내용 없음"}</Text>
                )}
              </View>
            );
          })}
        </Page>
      ))}
    </Document>
  );
}

// ─── Simple Layout ─────────────────────────────────────────────

function SimpleDoc({ pkg, isTeacher, template }: { pkg: LessonPackage; isTeacher: boolean; template: DocumentTemplate }) {
  const effectivePkg = applyTemplateContentLimits(pkg, template);
  const visible = new Set(template.visibleSections);
  const writingTasks = getWritingTasks(effectivePkg.writing);
  return (
    <Document>
        <Page size="A4" style={S.page}>
        <Text style={S.coverKicker}>{isTeacher ? "교사용 워크북" : "학생용 워크북"}</Text>
        <Text style={S.coverTitle}>{effectivePkg.title}</Text>
        <Text style={S.coverSub}>읽기 자료와 활동지를 한 장의 학습 문서 형식으로 정리한 출력본입니다.</Text>
        <View style={S.metaPanel}>
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>문서 유형</Text>
            <Text style={S.metaValue}>{isTeacher ? "교사용" : "학생용"}</Text>
          </View>
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>난이도</Text>
            <Text style={S.metaValue}>{effectivePkg.difficulty}</Text>
          </View>
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>단어 수</Text>
            <Text style={S.metaValue}>{effectivePkg.wordCount}</Text>
          </View>
        </View>
        <Rule />

        {visible.has("passage") && <SectionHeader title="지문" accentColor={template.accentColor} />}
        {visible.has("passage") && (
          <View style={S.paragraphBox}>
            {effectivePkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
              <Text key={i} style={S.para}>{p.trim()}</Text>
            ))}
          </View>
        )}
        {visible.has("passage") && <Rule />}

        {visible.has("reading") && <SectionHeader title="독해 문제" accentColor={template.accentColor} />}
        {visible.has("reading") && effectivePkg.reading.questions.map((q, i) => (
          <View key={i} style={S.questionBlock}>
            <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
            {q.options.map((opt, j) => (
              <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>
            ))}
            {isTeacher && <Text style={[S.indent, S.answer]}>▶ 정답: {q.answer}</Text>}
            {isTeacher && <Text style={[S.indent, S.muted]}>해설: {q.explanation}</Text>}
          </View>
        ))}
        {visible.has("reading") && <Rule />}

        {visible.has("vocabulary") && <SectionHeader title="어휘 학습" accentColor={template.accentColor} />}
        {visible.has("vocabulary") && (
        <View style={S.table}>
          <View style={S.tableHdr}>
            {["단어", "품사", "정의", "한국어", isTeacher ? "예문" : ""].map((h, i) => (
              <Text key={i} style={S.tableCellHdr}>{h}</Text>
            ))}
          </View>
          {effectivePkg.vocabulary.words.map((w, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={[S.tableCell, S.bold]}>{w.word}</Text>
              <Text style={[S.tableCell, S.muted]}>{w.partOfSpeech}</Text>
              <Text style={S.tableCell}>{w.definition}</Text>
              <Text style={S.tableCell}>{w.koreanTranslation}</Text>
              <Text style={S.tableCell}>{isTeacher ? w.exampleSentence : ""}</Text>
            </View>
          ))}
        </View>
        )}
        {visible.has("vocabulary") && <Rule />}

        {visible.has("grammar") && <SectionHeader title="문법 포인트" accentColor={template.accentColor} />}
        {visible.has("grammar") && <Text style={[S.para, S.bold]}>{effectivePkg.grammar.focusPoint}</Text>}
        {visible.has("grammar") && <Text style={S.para}>{effectivePkg.grammar.explanation}</Text>}
        {visible.has("grammar") && effectivePkg.grammar.examples.map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}
        {visible.has("grammar") && <Rule />}

        {visible.has("writing") && <SectionHeader title="쓰기 과제" accentColor={template.accentColor} />}
        {visible.has("writing") && writingTasks.map((task, index) => (
          <View key={index} style={S.questionBlock}>
            <Text style={[S.para, S.bold]}>{`쓰기 ${index + 1}. ${task.prompt}`}</Text>
            {task.scaffolding.map((s, i) => (
              <Text key={i} style={S.indent}>• {s}</Text>
            ))}
            {isTeacher && task.modelAnswer && (
              <>
                <Text style={[S.para, S.answer, { marginTop: 6 }]}>▶ 모범 답안</Text>
                <Text style={S.para}>{task.modelAnswer}</Text>
              </>
            )}
          </View>
        ))}
        {visible.has("writing") && <Rule />}

        {visible.has("assessment") && <SectionHeader title={`평가 문항 — 총 ${effectivePkg.assessment.totalPoints}점`} accentColor={template.accentColor} />}
        {visible.has("assessment") && effectivePkg.assessment.questions.map((q, i) => (
          <View key={i} style={S.questionBlock}>
            <Text style={S.para}><Text style={S.bold}>Q{i + 1}.</Text> [{q.points}점] {q.question}</Text>
            {q.options?.map((opt, j) => (
              <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>
            ))}
            {isTeacher && <Text style={[S.indent, S.answer]}>▶ 정답: {q.answer}</Text>}
          </View>
        ))}
      </Page>
    </Document>
  );
}

// ─── Advanced Layout ───────────────────────────────────────────

function AdvancedDoc({ pkg, isTeacher, template }: { pkg: LessonPackage; isTeacher: boolean; template: DocumentTemplate }) {
  const effectivePkg = applyTemplateContentLimits(pkg, template);
  const visible = new Set(template.visibleSections);
  const writingTasks = getWritingTasks(effectivePkg.writing);
  return (
    <Document>
      {/* Page 1: Cover + Passage */}
      <Page size="A4" style={S.pageAdv}>
        <Text style={S.coverKicker}>{isTeacher ? "교사용 워크북" : "학생용 워크북"}</Text>
        <Text style={S.coverTitle}>{effectivePkg.title}</Text>
        <Text style={S.coverSub}>자동 템플릿 기반으로 정리된 수업 자료입니다.</Text>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 18 }}>
          <Text style={[S.badge, { color: template.accentColor }]}>{effectivePkg.difficulty.toUpperCase()}</Text>
          <Text style={S.badge}>{effectivePkg.wordCount} WORDS</Text>
          <Text style={S.badge}>{isTeacher ? "교사용" : "학생용"}</Text>
        </View>

        {visible.has("passage") && <SectionHeader title="지문" advanced accentColor={template.accentColor} />}
        {visible.has("passage") && <View style={S.passBg}>
          {effectivePkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
            <Text key={i} style={S.para}>{p.trim()}</Text>
          ))}
        </View>}
      </Page>

      {/* Page 2: Reading + Vocabulary */}
      <Page size="A4" style={S.pageAdv}>
        {visible.has("reading") && <SectionHeader title="독해 문제" advanced accentColor={template.accentColor} />}
        {visible.has("reading") && (
        <View style={S.row2}>
          <View style={S.col}>
            {effectivePkg.reading.questions.slice(0, Math.ceil(effectivePkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={S.questionBlock}>
                <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {effectivePkg.reading.questions.slice(Math.ceil(effectivePkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={S.questionBlock}>
                <Text style={[S.para, S.bold]}>Q{i + Math.ceil(effectivePkg.reading.questions.length / 2) + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
        </View>
        )}

        {visible.has("vocabulary") && <SectionHeader title="어휘 학습" advanced accentColor={template.accentColor} />}
        {visible.has("vocabulary") && (
        <View style={S.table}>
          <View style={S.tableHdr}>
            {["Word", "POS", "Definition", "Korean"].map((h) => (
              <Text key={h} style={S.tableCellHdr}>{h}</Text>
            ))}
          </View>
          {effectivePkg.vocabulary.words.map((w, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={[S.tableCell, S.bold]}>{w.word}</Text>
              <Text style={[S.tableCell, S.muted]}>{w.partOfSpeech}</Text>
              <Text style={S.tableCell}>{w.definition}</Text>
              <Text style={S.tableCell}>{w.koreanTranslation}</Text>
            </View>
          ))}
        </View>
        )}
      </Page>

      {/* Page 3: Grammar + Writing + Assessment */}
      <Page size="A4" style={S.pageAdv}>
        {visible.has("grammar") && <SectionHeader title="문법 포인트" advanced accentColor={template.accentColor} />}
        {visible.has("grammar") && <Text style={[S.para, S.bold]}>{effectivePkg.grammar.focusPoint}</Text>}
        {visible.has("grammar") && <Text style={S.para}>{effectivePkg.grammar.explanation}</Text>}
        {visible.has("grammar") && effectivePkg.grammar.examples.slice(0, 3).map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}

        {visible.has("writing") && <SectionHeader title="쓰기 과제" advanced accentColor={template.accentColor} />}
        {visible.has("writing") && writingTasks.map((task, index) => (
          <View key={index} style={S.questionBlock}>
            <Text style={[S.para, S.bold]}>{`쓰기 ${index + 1}. ${task.prompt}`}</Text>
            {task.scaffolding.map((s, i) => <Text key={i} style={S.indent}>• {s}</Text>)}
            {isTeacher && task.modelAnswer && (
              <Text style={[S.para, S.answer, { marginTop: 4 }]}>모범: {task.modelAnswer}</Text>
            )}
          </View>
        ))}

        {visible.has("assessment") && <SectionHeader title={`평가 문항 — 총 ${effectivePkg.assessment.totalPoints}점`} advanced accentColor={template.accentColor} />}
        {visible.has("assessment") && <View style={S.row2}>
          <View style={S.col}>
            {effectivePkg.assessment.questions.slice(0, Math.ceil(effectivePkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={S.questionBlock}>
                <Text style={S.para}><Text style={S.bold}>Q{i + 1}.</Text> [{q.points}pt] {q.question}</Text>
                {q.options?.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {effectivePkg.assessment.questions.slice(Math.ceil(effectivePkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={S.questionBlock}>
                <Text style={S.para}><Text style={S.bold}>Q{i + Math.ceil(effectivePkg.assessment.questions.length / 2) + 1}.</Text> [{q.points}pt] {q.question}</Text>
                {q.options?.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
        </View>}
      </Page>
    </Document>
  );
}

// ─── Public API ────────────────────────────────────────────────

export async function generatePdf(
  pkg: LessonPackage,
  type: ExportType,
  template: DocumentTemplate
): Promise<Blob> {
  const doc = template.layout === "canvas"
    ? <CanvasDoc pkg={pkg} isTeacher={type === "teacher"} template={template} />
    : template.layout === "advanced"
      ? <AdvancedDoc pkg={pkg} isTeacher={type === "teacher"} template={template} />
      : <SimpleDoc pkg={pkg} isTeacher={type === "teacher"} template={template} />;

  return await pdf(doc).toBlob();
}
