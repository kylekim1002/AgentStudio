import React from "react";
import {
  Document, Page, Text, View, StyleSheet, pdf, Font,
} from "@react-pdf/renderer";
import { LessonPackage } from "@/lib/agents/types";

type ExportType  = "student" | "teacher";
type LayoutType  = "simple" | "advanced";

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
});

// ─── Helpers ──────────────────────────────────────────────────

function SectionHeader({ title, advanced }: { title: string; advanced?: boolean }) {
  return (
    <View style={advanced ? S.sectionHdrAdv : S.sectionHdr}>
      <Text style={S.sectionTitle}>{title}</Text>
    </View>
  );
}

function Rule() { return <View style={S.rule} />; }

// ─── Simple Layout ─────────────────────────────────────────────

function SimpleDoc({ pkg, isTeacher }: { pkg: LessonPackage; isTeacher: boolean }) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Cover */}
        <Text style={S.coverTitle}>{pkg.title}</Text>
        <Text style={S.coverSub}>난이도: {pkg.difficulty}  |  단어 수: {pkg.wordCount}  |  {isTeacher ? "교사용" : "학생용"}</Text>
        <Rule />

        {/* Passage */}
        <SectionHeader title="📖 지문 (Reading Passage)" />
        {pkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
          <Text key={i} style={S.para}>{p.trim()}</Text>
        ))}
        <Rule />

        {/* Reading */}
        <SectionHeader title="❓ 독해 문제 (Reading Questions)" />
        {pkg.reading.questions.map((q, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
            {q.options.map((opt, j) => (
              <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>
            ))}
            {isTeacher && <Text style={[S.indent, S.answer]}>▶ 정답: {q.answer}</Text>}
            {isTeacher && <Text style={[S.indent, S.muted]}>해설: {q.explanation}</Text>}
          </View>
        ))}
        <Rule />

        {/* Vocabulary */}
        <SectionHeader title="📝 어휘 학습 (Vocabulary)" />
        <View style={S.table}>
          <View style={S.tableHdr}>
            {["단어", "품사", "정의", "한국어", isTeacher ? "예문" : ""].map((h, i) => (
              <Text key={i} style={S.tableCellHdr}>{h}</Text>
            ))}
          </View>
          {pkg.vocabulary.words.map((w, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={[S.tableCell, S.bold]}>{w.word}</Text>
              <Text style={[S.tableCell, S.muted]}>{w.partOfSpeech}</Text>
              <Text style={S.tableCell}>{w.definition}</Text>
              <Text style={S.tableCell}>{w.koreanTranslation}</Text>
              <Text style={S.tableCell}>{isTeacher ? w.exampleSentence : ""}</Text>
            </View>
          ))}
        </View>
        <Rule />

        {/* Grammar */}
        <SectionHeader title="📐 문법 미니레슨 (Grammar)" />
        <Text style={[S.para, S.bold]}>{pkg.grammar.focusPoint}</Text>
        <Text style={S.para}>{pkg.grammar.explanation}</Text>
        {pkg.grammar.examples.map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}
        <Rule />

        {/* Writing */}
        <SectionHeader title="✍️ 쓰기 과제 (Writing)" />
        <Text style={[S.para, S.bold]}>{pkg.writing.prompt}</Text>
        {pkg.writing.scaffolding.map((s, i) => (
          <Text key={i} style={S.indent}>• {s}</Text>
        ))}
        {isTeacher && pkg.writing.modelAnswer && (
          <>
            <Text style={[S.para, S.answer, { marginTop: 6 }]}>▶ 모범 답안</Text>
            <Text style={S.para}>{pkg.writing.modelAnswer}</Text>
          </>
        )}
        <Rule />

        {/* Assessment */}
        <SectionHeader title={`📊 평가지 (Assessment) — 총 ${pkg.assessment.totalPoints}점`} />
        {pkg.assessment.questions.map((q, i) => (
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

function AdvancedDoc({ pkg, isTeacher }: { pkg: LessonPackage; isTeacher: boolean }) {
  return (
    <Document>
      {/* Page 1: Cover + Passage */}
      <Page size="A4" style={S.pageAdv}>
        <Text style={S.coverTitle}>{pkg.title}</Text>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 }}>
          <Text style={S.badge}>{pkg.difficulty.toUpperCase()}</Text>
          <Text style={S.badge}>{pkg.wordCount} WORDS</Text>
          <Text style={S.badge}>{isTeacher ? "TEACHER" : "STUDENT"}</Text>
        </View>

        <SectionHeader title="📖 Reading Passage" advanced />
        <View style={S.passBg}>
          {pkg.passage.split("\n\n").filter(Boolean).map((p, i) => (
            <Text key={i} style={S.para}>{p.trim()}</Text>
          ))}
        </View>
      </Page>

      {/* Page 2: Reading + Vocabulary */}
      <Page size="A4" style={S.pageAdv}>
        <SectionHeader title="❓ Reading Questions" advanced />
        <View style={S.row2}>
          <View style={S.col}>
            {pkg.reading.questions.slice(0, Math.ceil(pkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={[S.para, S.bold]}>Q{i + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {pkg.reading.questions.slice(Math.ceil(pkg.reading.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={[S.para, S.bold]}>Q{i + Math.ceil(pkg.reading.questions.length / 2) + 1}. {q.question}</Text>
                {q.options.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
        </View>

        <SectionHeader title="📝 Vocabulary" advanced />
        <View style={S.table}>
          <View style={S.tableHdr}>
            {["Word", "POS", "Definition", "Korean"].map((h) => (
              <Text key={h} style={S.tableCellHdr}>{h}</Text>
            ))}
          </View>
          {pkg.vocabulary.words.map((w, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={[S.tableCell, S.bold]}>{w.word}</Text>
              <Text style={[S.tableCell, S.muted]}>{w.partOfSpeech}</Text>
              <Text style={S.tableCell}>{w.definition}</Text>
              <Text style={S.tableCell}>{w.koreanTranslation}</Text>
            </View>
          ))}
        </View>
      </Page>

      {/* Page 3: Grammar + Writing + Assessment */}
      <Page size="A4" style={S.pageAdv}>
        <SectionHeader title="📐 Grammar Mini-Lesson" advanced />
        <Text style={[S.para, S.bold]}>{pkg.grammar.focusPoint}</Text>
        <Text style={S.para}>{pkg.grammar.explanation}</Text>
        {pkg.grammar.examples.slice(0, 3).map((ex, i) => (
          <Text key={i} style={S.indent}>• {ex}</Text>
        ))}

        <SectionHeader title="✍️ Writing Task" advanced />
        <Text style={[S.para, S.bold]}>{pkg.writing.prompt}</Text>
        {pkg.writing.scaffolding.map((s, i) => <Text key={i} style={S.indent}>• {s}</Text>)}
        {isTeacher && pkg.writing.modelAnswer && (
          <Text style={[S.para, S.answer, { marginTop: 4 }]}>모범: {pkg.writing.modelAnswer}</Text>
        )}

        <SectionHeader title={`📊 Assessment — ${pkg.assessment.totalPoints}pts`} advanced />
        <View style={S.row2}>
          <View style={S.col}>
            {pkg.assessment.questions.slice(0, Math.ceil(pkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={S.para}><Text style={S.bold}>Q{i + 1}.</Text> [{q.points}pt] {q.question}</Text>
                {q.options?.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
          <View style={S.col}>
            {pkg.assessment.questions.slice(Math.ceil(pkg.assessment.questions.length / 2)).map((q, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={S.para}><Text style={S.bold}>Q{i + Math.ceil(pkg.assessment.questions.length / 2) + 1}.</Text> [{q.points}pt] {q.question}</Text>
                {q.options?.map((opt, j) => <Text key={j} style={S.indent}>{String.fromCharCode(65 + j)}. {opt}</Text>)}
                {isTeacher && <Text style={[S.indent, S.answer]}>▶ {q.answer}</Text>}
              </View>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ─── Public API ────────────────────────────────────────────────

export async function generatePdf(
  pkg: LessonPackage,
  type: ExportType,
  layout: LayoutType
): Promise<Blob> {
  const doc = layout === "advanced"
    ? <AdvancedDoc pkg={pkg} isTeacher={type === "teacher"} />
    : <SimpleDoc  pkg={pkg} isTeacher={type === "teacher"} />;

  return await pdf(doc).toBlob();
}
