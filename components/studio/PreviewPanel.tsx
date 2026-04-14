"use client";

import { useState } from "react";
import { LessonPackage } from "@/lib/agents/types";
import { downloadBlob, safeFilename } from "@/lib/export/downloadFile";
import { DEFAULT_TEMPLATE_TEXT_STYLE, DocumentTemplate, getTemplateFontOption, resolveDocumentTemplate } from "@/lib/documentTemplates";
import {
  applyTemplateContentLimits,
  canvasLayoutLabel,
  renderCanvasTemplatePages,
} from "@/lib/documentTemplateRender";

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

interface PreviewPanelProps {
  lessonPackage: LessonPackage | null;
  onClose?: () => void;
  onSave?: () => void;
  canExportTeacher?: boolean;
  templates: DocumentTemplate[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
}

export default function PreviewPanel({
  lessonPackage,
  onClose,
  onSave,
  canExportTeacher = true,
  templates,
  selectedTemplateId,
  onSelectTemplate,
}: PreviewPanelProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["passage"]));
  const [exporting, setExporting] = useState<string | null>(null);
  const activeTemplate = resolveDocumentTemplate(templates, selectedTemplateId);
  const previewPackage = lessonPackage ? applyTemplateContentLimits(lessonPackage, activeTemplate) : null;

  function mmToPercentX(mm: number) {
    return (mm / PAGE_WIDTH_MM) * 100;
  }

  function mmToPercentY(mm: number) {
    return (mm / PAGE_HEIGHT_MM) * 100;
  }

  function getPreviewTextStyle(item: { fontFamily?: string; fontSize?: number; fontColor?: string; highlightColor?: string | null; bold?: boolean; italic?: boolean; underline?: boolean }, fallbackColor: string) {
    const font = getTemplateFontOption(item.fontFamily);
    return {
      fontFamily: font.webFamily,
      fontSize: `${Math.max(9, (item.fontSize ?? DEFAULT_TEMPLATE_TEXT_STYLE.fontSize) - 1)}px`,
      color: item.fontColor || fallbackColor,
      background: item.highlightColor || "transparent",
      fontWeight: item.bold ? 700 : 500,
      fontStyle: item.italic ? "italic" : "normal",
      textDecoration: item.underline ? "underline" : "none",
    } as const;
  }

  async function handleExport(type: "student" | "teacher", format: "pdf" | "docx") {
    if (!lessonPackage) return;
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      const fname = safeFilename(lessonPackage.title);
      if (format === "pdf") {
        const { generatePdf } = await import("@/lib/export/generatePdf");
        const blob = await generatePdf(lessonPackage, type, activeTemplate);
        downloadBlob(blob, `${fname}_${type === "teacher" ? "교사용" : "학생용"}_${activeTemplate.id}.pdf`);
      } else {
        const { generateDocx } = await import("@/lib/export/generateDocx");
        const blob = await generateDocx(lessonPackage, type, activeTemplate);
        downloadBlob(blob, `${fname}_${type === "teacher" ? "교사용" : "학생용"}_${activeTemplate.id}.docx`);
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

  const sections = previewPackage ? [
    { key: "passage",    icon: "📖", title: "지문", badge: `${previewPackage.wordCount} words`, content: previewPackage.passage },
    { key: "reading",    icon: "❓", title: "독해 문제", badge: `${previewPackage.reading.questions.length}문항`, content: previewPackage.reading.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n") },
    { key: "vocabulary", icon: "📝", title: "어휘 학습", badge: `${previewPackage.vocabulary.words.length}단어`, content: previewPackage.vocabulary.words.map((w) => `• ${w.word} — ${w.definition}`).join("\n") },
    { key: "grammar",    icon: "📐", title: "문법 미니레슨", badge: null, content: `${previewPackage.grammar.focusPoint}\n\n${previewPackage.grammar.explanation}` },
    { key: "writing",    icon: "✍️", title: "쓰기 과제", badge: null, content: previewPackage.writing.prompt },
    { key: "assessment", icon: "📊", title: "평가지", badge: `${previewPackage.assessment.questions.length}문항 / ${previewPackage.assessment.totalPoints}점`, content: previewPackage.assessment.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n") },
  ].filter((section) => activeTemplate.visibleSections.includes(section.key as typeof activeTemplate.visibleSections[number])) : [];

  const canvasPages =
    previewPackage && activeTemplate.layout === "canvas"
      ? renderCanvasTemplatePages(activeTemplate, previewPackage, false)
      : [];

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
      {!previewPackage ? (
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
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)" }}>{previewPackage.title}</div>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "4px" }}>
              <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-primary-light)", color: "var(--color-primary)", fontWeight: "600" }}>{previewPackage.difficulty}</span>
              <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{previewPackage.wordCount} words</span>
            </div>
          </div>

          {canvasPages.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>
                A4 템플릿 미리보기
              </div>
              <div style={{ display: "grid", gap: "10px" }}>
                {canvasPages.map((page, pageIndex) => (
                  <div key={page.id}>
                    <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginBottom: "4px" }}>
                      {pageIndex + 1}페이지
                    </div>
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "210 / 297",
                        background: "#fff",
                        border: "1px solid var(--color-border)",
                        borderRadius: "10px",
                        overflow: "hidden",
                        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
                      }}
                    >
                      {page.items.map((item) => {
                        return (
                          <div
                            key={item.id}
                            style={{
                              position: "absolute",
                              left: `${mmToPercentX(item.x)}%`,
                              top: `${mmToPercentY(item.y)}%`,
                              width: `${mmToPercentX(item.w)}%`,
                              height: `${mmToPercentY(item.h)}%`,
                              borderRadius: "8px",
                              border: `1px solid ${item.type === "image" ? "#BFDBFE" : "var(--color-border)"}`,
                              background: item.type === "image" ? "#EFF6FF" : "#F8FAFC",
                              padding: "6px",
                              overflow: "hidden",
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                            }}
                          >
                            <div style={{ ...getPreviewTextStyle(item, "var(--color-text)"), fontWeight: item.bold ? 700 : 600 }}>
                              {item.label}
                            </div>
                            {item.type === "image" ? (
                              item.resolvedImage ? (
                                <img
                                  src={item.resolvedImage.url}
                                  alt={item.label}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "6px" }}
                                />
                              ) : (
                                <div style={{ ...getPreviewTextStyle(item, "var(--color-text-subtle)"), lineHeight: 1.5 }}>
                                  연결된 생성 이미지가 없습니다.
                                </div>
                              )
                            ) : (
                              <div style={{ ...getPreviewTextStyle(item, "var(--color-text-muted)"), lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                                {item.renderedText || "내용 없음"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {page.isOverflow && (
                      <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-subtle)" }}>
                        자동 overflow 페이지
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {previewPackage.generatedImages && previewPackage.generatedImages.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>
                생성된 이미지
              </div>
              <div style={{ display: "grid", gap: "8px" }}>
                {previewPackage.generatedImages.map((image) => (
                  <div
                    key={image.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      background: "var(--color-surface)",
                      overflow: "hidden",
                    }}
                  >
                    <img src={image.url} alt="생성 이미지" style={{ width: "100%", display: "block", background: "#F8FAFC" }} />
                    <div style={{ padding: "8px", fontSize: "10px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                      {image.prompt}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
        <div style={{ display: "grid", gap: "8px", marginBottom: "8px" }}>
          <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-muted)" }}>템플릿</div>
          <select
            value={selectedTemplateId}
            onChange={(e) => onSelectTemplate(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 9px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              fontSize: "11px",
              color: "var(--color-text)",
              background: "var(--color-surface)",
            }}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
            {activeTemplate.pageSize} · {canvasLayoutLabel(activeTemplate)} · {activeTemplate.previewLabel}
          </div>
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
