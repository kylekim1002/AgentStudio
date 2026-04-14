"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  DocumentSectionKey,
  DocumentTemplate,
  DocumentTemplateBlock,
  normalizeDocumentTemplates,
} from "@/lib/documentTemplates";

const SECTION_OPTIONS: Array<{ key: DocumentSectionKey; label: string }> = [
  { key: "passage", label: "지문" },
  { key: "reading", label: "독해" },
  { key: "vocabulary", label: "어휘" },
  { key: "grammar", label: "문법" },
  { key: "writing", label: "쓰기" },
  { key: "assessment", label: "평가지" },
];

const BLOCK_TYPES: Array<{ value: DocumentTemplateBlock["type"]; label: string }> = [
  { value: "text", label: "텍스트" },
  { value: "multiple_choice", label: "객관식" },
  { value: "short_answer", label: "주관식" },
  { value: "image", label: "이미지" },
];

function createEmptyTemplate(index: number): DocumentTemplate {
  return {
    id: `custom-template-${Date.now()}-${index}`,
    name: `새 템플릿 ${index}`,
    description: "",
    previewLabel: "새 템플릿",
    pageSize: "A4",
    layout: "simple",
    accentColor: "#4F46E5",
    visibleSections: ["passage", "reading", "assessment"],
    blocks: [
      { id: `block-${Date.now()}-1`, type: "text", label: "지시문 텍스트", enabled: true },
      { id: `block-${Date.now()}-2`, type: "multiple_choice", label: "문제 영역", enabled: true },
    ],
  };
}

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>(DEFAULT_DOCUMENT_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(DEFAULT_DOCUMENT_TEMPLATES[0].id);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/system-settings/document-templates")
      .then((res) => res.json())
      .then((data) => {
        const nextTemplates = normalizeDocumentTemplates(data.templates);
        setTemplates(nextTemplates);
        setSelectedTemplateId(nextTemplates[0]?.id ?? DEFAULT_DOCUMENT_TEMPLATES[0].id);
      })
      .catch(() => {});
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId, templates]
  );

  function updateTemplate(patch: Partial<DocumentTemplate>) {
    if (!selectedTemplate) return;
    setTemplates((prev) =>
      prev.map((template) =>
        template.id === selectedTemplate.id
          ? {
              ...template,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : template
      )
    );
  }

  function toggleSection(section: DocumentSectionKey) {
    if (!selectedTemplate) return;
    const exists = selectedTemplate.visibleSections.includes(section);
    const nextSections = exists
      ? selectedTemplate.visibleSections.filter((item) => item !== section)
      : [...selectedTemplate.visibleSections, section];
    updateTemplate({ visibleSections: nextSections });
  }

  function updateBlock(blockId: string, patch: Partial<DocumentTemplateBlock>) {
    if (!selectedTemplate) return;
    updateTemplate({
      blocks: selectedTemplate.blocks.map((block) =>
        block.id === blockId ? { ...block, ...patch } : block
      ),
    });
  }

  function addBlock() {
    if (!selectedTemplate) return;
    updateTemplate({
      blocks: [
        ...selectedTemplate.blocks,
        {
          id: `block-${Date.now()}`,
          type: "text",
          label: `블록 ${selectedTemplate.blocks.length + 1}`,
          enabled: true,
        },
      ],
    });
  }

  function addTemplate() {
    const next = createEmptyTemplate(templates.length + 1);
    setTemplates((prev) => [...prev, next]);
    setSelectedTemplateId(next.id);
  }

  async function saveTemplates() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/system-settings/document-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error ?? "저장 실패");
      return;
    }
    setTemplates(normalizeDocumentTemplates(data.templates));
    setMessage("템플릿이 저장되었습니다.");
    window.setTimeout(() => setMessage(null), 2500);
  }

  return (
    <div style={{ flex: 1, overflow: "auto", background: "var(--color-bg)" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "13px", color: "var(--color-text-subtle)", marginBottom: "6px" }}>문서 템플릿</div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "750", color: "var(--color-text)", letterSpacing: "-0.03em" }}>
              템플릿 관리
            </h1>
            <p style={{ marginTop: "10px", fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.7, maxWidth: "720px" }}>
              시작 전에 템플릿을 선택하고, PDF/DOCX 내보내기 때 동일한 템플릿이 적용됩니다. A4 기준으로 섹션, 강조색, 블록 구성을 관리할 수 있습니다.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {message && <div style={{ fontSize: "12px", color: "var(--color-primary)" }}>{message}</div>}
            <button
              type="button"
              onClick={addTemplate}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              템플릿 추가
            </button>
            <button
              type="button"
              onClick={() => void saveTemplates()}
              disabled={saving}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "700",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "저장 중..." : "템플릿 저장"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr)", gap: "16px" }}>
          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", fontSize: "13px", fontWeight: "700", color: "var(--color-text)" }}>
              템플릿 목록
            </div>
            <div style={{ display: "grid" }}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px minmax(0, 1fr)",
                    gap: "12px",
                    alignItems: "center",
                    padding: "14px 16px",
                    border: "none",
                    borderTop: "1px solid var(--color-border)",
                    background: selectedTemplateId === template.id ? "var(--color-primary-light)" : "var(--color-surface)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{
                    width: "72px",
                    height: "96px",
                    borderRadius: "10px",
                    border: `1px solid ${template.accentColor}33`,
                    background: "#fff",
                    boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
                    padding: "8px",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}>
                    <div style={{ height: "10px", borderRadius: "999px", background: template.accentColor }} />
                    <div style={{ display: "grid", gap: "4px" }}>
                      <div style={{ height: "5px", borderRadius: "999px", background: "#CBD5E1" }} />
                      <div style={{ height: "5px", borderRadius: "999px", background: "#E2E8F0" }} />
                      <div style={{ height: "18px", borderRadius: "6px", background: `${template.accentColor}22` }} />
                    </div>
                    <div style={{ fontSize: "9px", fontWeight: "700", color: template.accentColor }}>
                      {template.previewLabel}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text)" }}>{template.name}</div>
                    <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                      {template.description || "설명이 없습니다."}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {selectedTemplate && (
            <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: "16px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "grid", gap: "12px" }}>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>템플릿명</span>
                      <input
                        value={selectedTemplate.name}
                        onChange={(e) => updateTemplate({ name: e.target.value })}
                        style={{ padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>설명</span>
                      <textarea
                        value={selectedTemplate.description}
                        onChange={(e) => updateTemplate({ description: e.target.value })}
                        rows={3}
                        style={{ padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px", resize: "vertical" }}
                      />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>미리보기 라벨</span>
                        <input
                          value={selectedTemplate.previewLabel}
                          onChange={(e) => updateTemplate({ previewLabel: e.target.value })}
                          style={{ padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>레이아웃</span>
                        <select
                          value={selectedTemplate.layout}
                          onChange={(e) => updateTemplate({ layout: e.target.value as "simple" | "advanced" })}
                          style={{ padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                        >
                          <option value="simple">심플</option>
                          <option value="advanced">고급</option>
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>강조색</span>
                        <input
                          type="color"
                          value={selectedTemplate.accentColor}
                          onChange={(e) => updateTemplate({ accentColor: e.target.value })}
                          style={{ width: "100%", height: "42px", padding: "4px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "#fff" }}
                        />
                      </label>
                    </div>
                  </div>

                  <div style={{ marginTop: "18px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)", marginBottom: "8px" }}>
                      A4 표시 섹션
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {SECTION_OPTIONS.map((section) => {
                        const active = selectedTemplate.visibleSections.includes(section.key);
                        return (
                          <button
                            key={section.key}
                            type="button"
                            onClick={() => toggleSection(section.key)}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "999px",
                              border: `1px solid ${active ? selectedTemplate.accentColor : "var(--color-border)"}`,
                              background: active ? `${selectedTemplate.accentColor}18` : "var(--color-surface)",
                              color: active ? selectedTemplate.accentColor : "var(--color-text-muted)",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                            }}
                          >
                            {section.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ marginTop: "18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>
                        블록 구성
                      </div>
                      <button
                        type="button"
                        onClick={addBlock}
                        style={{
                          padding: "6px 9px",
                          borderRadius: "8px",
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                      >
                        블록 추가
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: "8px" }}>
                      {selectedTemplate.blocks.map((block) => (
                        <div key={block.id} style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr) auto", gap: "8px", alignItems: "center" }}>
                          <select
                            value={block.type}
                            onChange={(e) => updateBlock(block.id, { type: e.target.value as DocumentTemplateBlock["type"] })}
                            style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                          >
                            {BLOCK_TYPES.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <input
                            value={block.label}
                            onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                            style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                          />
                          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-text-muted)" }}>
                            <input
                              type="checkbox"
                              checked={block.enabled}
                              onChange={(e) => updateBlock(block.id, { enabled: e.target.checked })}
                            />
                            사용
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)", marginBottom: "10px" }}>미리보기</div>
                  <div style={{
                    width: "100%",
                    aspectRatio: "210 / 297",
                    borderRadius: "16px",
                    background: "#fff",
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 20px 40px rgba(15,23,42,0.08)",
                    padding: "18px",
                    boxSizing: "border-box",
                    display: "grid",
                    alignContent: "start",
                    gap: "10px",
                  }}>
                    <div style={{ height: "16px", borderRadius: "999px", background: selectedTemplate.accentColor }} />
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--color-text)" }}>{selectedTemplate.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>{selectedTemplate.description || "A4 기준 미리보기"}</div>
                    {selectedTemplate.visibleSections.map((section) => (
                      <div key={section} style={{ borderRadius: "10px", background: `${selectedTemplate.accentColor}14`, border: `1px solid ${selectedTemplate.accentColor}22`, padding: "10px" }}>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: selectedTemplate.accentColor }}>
                          {SECTION_OPTIONS.find((item) => item.key === section)?.label}
                        </div>
                        <div style={{ marginTop: "6px", display: "grid", gap: "4px" }}>
                          {selectedTemplate.blocks.filter((block) => block.enabled).slice(0, 2).map((block) => (
                            <div key={block.id} style={{ height: "10px", borderRadius: "999px", background: "#E2E8F0" }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
