"use client";

import { useState } from "react";
import { LessonPackage } from "@/lib/agents/types";
import { downloadBlob, safeFilename } from "@/lib/export/downloadFile";

interface PreviewPanelProps {
  lessonPackage: LessonPackage | null;
  onClose?: () => void;
  onSave?: () => void;
  canExportTeacher?: boolean;
}

type Layout = "simple" | "advanced";

export default function PreviewPanel({ lessonPackage, onClose, onSave, canExportTeacher = true }: PreviewPanelProps) {
  const [layout, setLayout] = useState<Layout>("simple");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["passage"]));
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(type: "student" | "teacher", format: "pdf" | "docx") {
    if (!lessonPackage) return;
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      const fname = safeFilename(lessonPackage.title);
      if (format === "pdf") {
        const { generatePdf } = await import("@/lib/export/generatePdf");
        const blob = await generatePdf(lessonPackage, type, layout);
        downloadBlob(blob, `${fname}_${type === "teacher" ? "교사용" : "학생용"}_${layout}.pdf`);
      } else {
        const { generateDocx } = await import("@/lib/export/generateDocx");
        const blob = await generateDocx(lessonPackage, type);
        downloadBlob(blob, `${fname}_${type === "teacher" ? "교사용" : "학생용"}.docx`);
      }
    } finally {
      setExporting(null);
    }
  }

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sections = lessonPackage ? [
    { key: "passage",    icon: "📖", title: "지문", badge: `${lessonPackage.wordCount} words`, content: lessonPackage.passage },
    { key: "reading",    icon: "❓", title: "독해 문제", badge: `${lessonPackage.reading.questions.length}문항`, content: lessonPackage.reading.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n") },
    { key: "vocabulary", icon: "📝", title: "어휘 학습", badge: `${lessonPackage.vocabulary.words.length}단어`, content: lessonPackage.vocabulary.words.map((w) => `• ${w.word} — ${w.definition}`).join("\n") },
    { key: "grammar",    icon: "📐", title: "문법 미니레슨", badge: null, content: `${lessonPackage.grammar.focusPoint}\n\n${lessonPackage.grammar.explanation}` },
    { key: "writing",    icon: "✍️", title: "쓰기 과제", badge: null, content: lessonPackage.writing.prompt },
    { key: "assessment", icon: "📊", title: "평가지", badge: `${lessonPackage.assessment.questions.length}문항 / ${lessonPackage.assessment.totalPoints}점`, content: lessonPackage.assessment.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n") },
  ] : [];

  return (
    <aside style={{
      width: "300px", flexShrink: 0,
      background: "var(--color-surface)",
      borderLeft: "1px solid var(--color-border)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "11px 14px", borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)" }}>📄 문서 미리보기</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button title="새로고침" style={{ width: "24px", height: "24px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "13px" }}>↺</button>
          {onClose && (
            <button onClick={onClose} title="닫기" style={{ width: "24px", height: "24px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "13px" }}>✕</button>
          )}
        </div>
      </div>

      {/* Save banner — shown when lesson is ready */}
      {lessonPackage && onSave && (
        <div style={{
          padding: "8px 12px",
          background: "linear-gradient(135deg, #EFF6FF, #F0FDF4)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", gap: "8px",
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, fontSize: "11px", color: "var(--color-text-muted)", lineHeight: "1.4" }}>
            레슨이 생성되었습니다
          </div>
          <button
            onClick={onSave}
            style={{
              padding: "6px 12px", borderRadius: "6px",
              background: "var(--color-primary)", color: "#fff",
              fontSize: "11px", fontWeight: "700",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "5px",
              flexShrink: 0,
            }}
          >
            💾 학습자료소에 저장
          </button>
        </div>
      )}

      {/* Content */}
      {!lessonPackage ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", padding: "24px" }}>
          <div style={{ fontSize: "28px", opacity: .35 }}>📋</div>
          <div style={{ fontSize: "12px", color: "var(--color-text-muted)", textAlign: "center", lineHeight: "1.7" }}>
            레슨이 생성되면<br/>여기서 미리볼 수 있습니다
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {/* Lesson title */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)" }}>{lessonPackage.title}</div>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "4px" }}>
              <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-primary-light)", color: "var(--color-primary)", fontWeight: "600" }}>{lessonPackage.difficulty}</span>
              <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{lessonPackage.wordCount} words</span>
            </div>
          </div>

          {/* Sections */}
          {sections.map(({ key, icon, title, badge, content }) => (
            <div key={key} style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "7px", overflow: "hidden", marginBottom: "8px" }}>
              <div
                onClick={() => toggleSection(key)}
                style={{
                  padding: "8px 10px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "var(--color-surface)", borderBottom: openSections.has(key) ? "1px solid var(--color-border)" : "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)", display: "flex", alignItems: "center", gap: "5px" }}>
                  {icon} {title}
                  {badge && (
                    <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)", fontWeight: "400" }}>
                      {badge}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>
                  {openSections.has(key) ? "▾" : "▸"}
                </span>
              </div>
              {openSections.has(key) && (
                <div style={{ padding: "10px", fontSize: "11px", color: "var(--color-text-muted)", lineHeight: "1.7", whiteSpace: "pre-wrap", maxHeight: "180px", overflowY: "auto" }}>
                  {content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Export footer */}
      <div style={{ padding: "11px 12px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        {/* Layout toggle */}
        <div style={{ display: "flex", gap: "5px", marginBottom: "8px" }}>
          <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-muted)", alignSelf: "center", marginRight: "3px" }}>레이아웃</div>
          {(["simple", "advanced"] as Layout[]).map((l) => (
            <button
              key={l}
              onClick={() => setLayout(l)}
              style={{
                flex: 1, padding: "4px 8px", borderRadius: "5px",
                border: `1px solid ${layout === l ? "var(--color-primary)" : "var(--color-border)"}`,
                background: layout === l ? "var(--color-primary-light)" : "var(--color-surface)",
                color: layout === l ? "var(--color-primary)" : "var(--color-text-muted)",
                fontSize: "10px", fontWeight: "600", cursor: "pointer", transition: ".15s",
              }}
            >
              {l === "simple" ? "심플" : "고급"}
            </button>
          ))}
        </div>

        {/* Export buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
          {([
            { label: "학생용 PDF",  icon: "📄", type: "student" as const, format: "pdf"  as const },
            ...(canExportTeacher ? [{ label: "교사용 PDF",  icon: "📋", type: "teacher" as const, format: "pdf"  as const }] : []),
            { label: "학생용 DOCX", icon: "📝", type: "student" as const, format: "docx" as const },
            ...(canExportTeacher ? [{ label: "교사용 DOCX", icon: "🗒", type: "teacher" as const, format: "docx" as const }] : []),
          ] as const).map(({ label, icon, type, format }) => {
            const key = `${type}-${format}`;
            const busy = exporting === key;
            return (
            <button
              key={label}
              disabled={!lessonPackage || !!exporting}
              onClick={() => handleExport(type, format)}
              style={{
                padding: "7px 6px", borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: lessonPackage ? "var(--color-text-muted)" : "var(--color-text-subtle)",
                fontSize: "10px", fontWeight: "500",
                cursor: lessonPackage && !exporting ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                transition: ".15s",
              }}
              onMouseOver={(e) => {
                if (!lessonPackage || exporting) return;
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-primary)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-primary)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--color-primary-light)";
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface)";
              }}
            >
              {busy ? "⏳" : icon} {busy ? "생성 중..." : label}
            </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
