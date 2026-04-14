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

type ExportType  = "student" | "teacher";
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// ─── Styles ───────────────────────────────────────────────────

const S = StyleSheet.create({
  page:       { fontFamily: "Helvetica", fontSize: 10, color: "#0F172A", padding: "48 52 48 52" },
  // Advanced layout: 2-column cover + colored section headers
  pageAdv:    { fontFamily: "Helvetica", fontSize: 10, color: "#0F172A", padding: "40 44 40 44" },

  // Cover
  coverTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 6, textAlign: "center" },
  coverSub:   { fontSize: 10, color: "#64748B", textAlign: "center", marginBottom: 28 },

  // Section header
  sectionHdr: { backgroundColor: "#4F46E5", color: "#fff", padding: "5 10", borderRadius: 4, marginBottom: 8, marginTop: 16 },
  sectionHdrAdv: { backgroundColor: "#4F46E5", color: "#fff", padding: "6 12", borderRadius: 4, marginBottom: 8, marginTop: 20 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, color: "#fff" },

  // Body
  para:       { marginBottom: 6, lineHeight: 1.6 },
  bold:       { fontFamily: "Helvetica-Bold" },
  muted:      { color: "#64748B" },
  answer:     { color: "#059669", fontFamily: "Helvetica-Bold" },
  indent:     { marginLeft: 12, marginBottom: 4 },

  // Table
  table:      { marginBottom: 10 },
  tableHdr:   { backgroundColor: "#EEF2FF", flexDirection: "row" },
  tableRow:   { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E2E8F0" },
  tableCell:  { padding: "4 6", flex: 1, fontSize: 9 },
  tableCellHdr: { padding: "4 6", flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold", color: "#4F46E5" },

  // Rule
  rule:       { borderBottomWidth: 0.5, borderBottomColor: "#E2E8F0", marginVertical: 10 },

  // Advanced: 2-col
  row2:       { flexDirection: "row", gap: 12 },
  col:        { flex: 1 },
  badge:      { backgroundColor: "#EEF2FF", color: "#4F46E5", fontSize: 8, padding: "2 6", borderRadius: 3, alignSelf: "flex-start", marginBottom: 4, fontFamily: "Helvetica-Bold" },
  passBg:     { backgroundColor: "#F8FAFC", padding: "10 12", borderRadius: 6, borderWidth: 0.5, borderColor: "#E2E8F0", marginBottom: 10 },
  canvasPage: { fontFamily: "Helvetica", fontSize: 10, color: "#0F172A", padding: "20 20 20 20", backgroundColor: "#FFFFFF" },
  canvasBox: { position: "absolute", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 6, padding: 6, overflow: "hidden" },
  canvasItemLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 4, color: "#0F172A" },
  canvasItemText: { fontSize: 8, lineHeight: 1.35, color: "#334155" },
  canvasImage: { width: "100%", height: "100%", objectFit: "cover" },
  canvasPlaceholder: { fontSize: 8, color: "#64748B", lineHeight: 1.4 },
});

// ─── Helpers ──────────────────────────────────────────────────

function SectionHeader({ title, advanced, accentColor }: { title: string; advanced?: boolean; accentColor: string }) {
  return (
    <View style={[advanced ? S.sectionHdrAdv : S.sectionHdr, { backgroundColor: accentColor }]}>
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
                    borderColor: item.type === "image" ? "#93C5FD" : "#CBD5E1",
                    backgroundColor: item.type === "image" ? "#EFF6FF" : "#F8FAFC",
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
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Cover */}
        <Text style={S.coverTitle}>{effectivePkg.title}</Text>
        <Text style={S.coverSub}>난이도: {effectivePkg.difficulty}  |  단어 수: {effectivePkg.wordCount}  |  {isTeacher ? "교사용" : "학생용"}</Text>
        <Rule />

        {/* Passage */}
        {visible.has("passage") && <SectionHeader title="📖 지문 (Reading Passage)" accentColor={template.accentColor} />}
        {visible.has("passage") && effectivePkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
          <Text key={i} style={S.para}>{p.trim()}</Text>
        ))}
        {visible.has("passage") && <Rule />}

        {/* Reading */}
        {visible.has("reading") && <SectionHeader title="❓ 독해 문제 (Reading Questions)" accentColor={template.accentColor} />}
        {visible.has("reading") && effectivePkg.reading.questions.map((q, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
            {q.options.map((opt, j) => (
              <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>
            ))}
            {isTeacher && <Text style={[S.indent, S.answer]}>▶ 정답: {q.answer}</Text>}
            {isTeacher && <Text style={[S.indent, S.muted]}>해설: {q.explanation}</Text>}
          </View>
        ))}
        {visible.has("reading") && <Rule />}

        {/* Vocabulary */}
        {visible.has("vocabulary") && <SectionHeader title="📝 어휘 학습 (Vocabulary)" accentColor={template.accentColor} />}
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

        {/* Grammar */}
        {visible.has("grammar") && <SectionHeader title="📐 문법 미니레슨 (Grammar)" accentColor={template.accentColor} />}
        {visible.has("grammar") && <Text style={[S.para, S.bold]}>{effectivePkg.grammar.focusPoint}</Text>}
        {visible.has("grammar") && <Text style={S.para}>{effectivePkg.grammar.explanation}</Text>}
        {visible.has("grammar") && effectivePkg.grammar.examples.map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}
        {visible.has("grammar") && <Rule />}

        {/* Writing */}
        {visible.has("writing") && <SectionHeader title="✍️ 쓰기 과제 (Writing)" accentColor={template.accentColor} />}
        {visible.has("writing") && <Text style={[S.para, S.bold]}>{effectivePkg.writing.prompt}</Text>}
        {visible.has("writing") && effectivePkg.writing.scaffolding.map((s, i) => (
          <Text key={i} style={S.indent}>• {s}</Text>
        ))}
        {visible.has("writing") && isTeacher && effectivePkg.writing.modelAnswer && (
          <>
            <Text style={[S.para, S.answer, { marginTop: 6 }]}>▶ 모범 답안</Text>
            <Text style={S.para}>{effectivePkg.writing.modelAnswer}</Text>
          </>
        )}
        {visible.has("writing") && <Rule />}

        {/* Assessment */}
        {visible.has("assessment") && <SectionHeader title={`📊 평가지 (Assessment) — 총 ${effectivePkg.assessment.totalPoints}점`} accentColor={template.accentColor} />}
        {visible.has("assessment") && effectivePkg.assessment.questions.map((q, i) => (
          <View key={i} style={{ marginBottom: 8 }}>
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
  return (
    <Document>
      {/* Page 1: Cover + Passage */}
      <Page size="A4" style={S.pageAdv}>
        <Text style={S.coverTitle}>{effectivePkg.title}</Text>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 }}>
          <Text style={[S.badge, { color: template.accentColor }]}>{effectivePkg.difficulty.toUpperCase()}</Text>
          <Text style={S.badge}>{effectivePkg.wordCount} WORDS</Text>
          <Text style={S.badge}>{isTeacher ? "TEACHER" : "STUDENT"}</Text>
        </View>

        {visible.has("passage") && <SectionHeader title="📖 Reading Passage" advanced accentColor={template.accentColor} />}
        {visible.has("passage") && <View style={S.passBg}>
          {effectivePkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
            <Text key={i} style={S.para}>{p.trim()}</Text>
          ))}
        </View>}
      </Page>

      {/* Page 2: Reading + Vocabulary */}
      <Page size="A4" style={S.pageAdv}>
        {visible.has("reading") && <SectionHeader title="❓ Reading Questions" advanced accentColor={template.accentColor} />}
        {visible.has("reading") && (
        <View style={S.row2}>
          <View style={S.col}>
            {effectivePkg.reading.questions.slice(0, Math.ceil(effectivePkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {effectivePkg.reading.questions.slice(Math.ceil(effectivePkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={[S.para, S.bold]}>Q{i + Math.ceil(effectivePkg.reading.questions.length / 2) + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
        </View>
        )}

        {visible.has("vocabulary") && <SectionHeader title="📝 Vocabulary" advanced accentColor={template.accentColor} />}
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
        {visible.has("grammar") && <SectionHeader title="📐 Grammar Mini-Lesson" advanced accentColor={template.accentColor} />}
        {visible.has("grammar") && <Text style={[S.para, S.bold]}>{effectivePkg.grammar.focusPoint}</Text>}
        {visible.has("grammar") && <Text style={S.para}>{effectivePkg.grammar.explanation}</Text>}
        {visible.has("grammar") && effectivePkg.grammar.examples.slice(0, 3).map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}

        {visible.has("writing") && <SectionHeader title="✍️ Writing Task" advanced accentColor={template.accentColor} />}
        {visible.has("writing") && <Text style={[S.para, S.bold]}>{effectivePkg.writing.prompt}</Text>}
        {visible.has("writing") && effectivePkg.writing.scaffolding.map((s, i) => <Text key={i} style={S.indent}>• {s}</Text>)}
        {visible.has("writing") && isTeacher && effectivePkg.writing.modelAnswer && (
          <Text style={[S.para, S.answer, { marginTop: 4 }]}>모범: {effectivePkg.writing.modelAnswer}</Text>
        )}

        {visible.has("assessment") && <SectionHeader title={`📊 Assessment — ${effectivePkg.assessment.totalPoints}pts`} advanced accentColor={template.accentColor} />}
        {visible.has("assessment") && <View style={S.row2}>
          <View style={S.col}>
            {effectivePkg.assessment.questions.slice(0, Math.ceil(effectivePkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={S.para}><Text style={S.bold}>Q{i + 1}.</Text> [{q.points}pt] {q.question}</Text>
                {q.options?.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {effectivePkg.assessment.questions.slice(Math.ceil(effectivePkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
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
