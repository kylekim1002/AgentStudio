"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import {
  CURRICULUM_SEMESTERS,
  CURRICULUM_SUBJECTS,
  CURRICULUM_TYPES,
  CurriculumAssetDetail,
  CurriculumAssetSummary,
} from "@/lib/curriculum";

export default function CurriculumClient({ viewerId }: { viewerId: string }) {
  const [assets, setAssets] = useState<CurriculumAssetSummary[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetDetail, setAssetDetail] = useState<CurriculumAssetDetail | null>(null);
  const [detailDraft, setDetailDraft] = useState<CurriculumAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [transformingAssetId, setTransformingAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [semester, setSemester] = useState("");
  const [levelName, setLevelName] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState("");
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [lexileMin, setLexileMin] = useState("");
  const [lexileMax, setLexileMax] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId]
  );

  async function loadAssets() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (semester) params.set("semester", semester);
      if (levelName) params.set("level", levelName);
      if (subject) params.set("subject", subject);
      if (contentType) params.set("type", contentType);
      if (status) params.set("status", status);
      const res = await fetch(`/api/curriculum/assets?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "자료를 불러오지 못했습니다.");
      setAssets(data.assets ?? []);
      setSelectedAssetId((current) =>
        (data.assets ?? []).some((asset: CurriculumAssetSummary) => asset.id === current)
          ? current
          : data.assets?.[0]?.id ?? null
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester, levelName, subject, contentType, status]);

  useEffect(() => {
    if (!selectedAssetId) {
      setAssetDetail(null);
      setDetailDraft(null);
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/curriculum/assets/${selectedAssetId}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "상세 자료를 불러오지 못했습니다.");
        if (cancelled) return;
        setAssetDetail(data.asset ?? null);
        setDetailDraft(data.asset ?? null);
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "상세 자료를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedAssetId]);

  async function handleUpload() {
    if (!file) {
      setError("업로드할 파일을 선택해 주세요.");
      return;
    }
    if (!title.trim() || !semester || !levelName.trim() || !subject || !contentType) {
      setError("자료명, 학기, 레벨, 과목, 유형은 필수입니다.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      formData.append("semester", semester);
      formData.append("levelName", levelName.trim());
      formData.append("subject", subject);
      formData.append("contentType", contentType);
      formData.append("notes", notes.trim());
      if (lexileMin.trim()) formData.append("lexileMin", lexileMin.trim());
      if (lexileMax.trim()) formData.append("lexileMax", lexileMax.trim());

      const res = await fetch("/api/curriculum/assets", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드에 실패했습니다.");

      setTitle("");
      setNotes("");
      setLexileMin("");
      setLexileMax("");
      setFile(null);
      await loadAssets();
      setSelectedAssetId(data.asset?.id ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "업로드에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTransform(assetId: string) {
    setTransformingAssetId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/curriculum/assets/${assetId}/transform`, { method: "POST" });
      const data = await res.json();
      if (!res.ok && data?.error) throw new Error(data.error);
      if (data?.ok === false && data?.message) {
        throw new Error(data.message);
      }
      await loadAssets();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "구조화 변환에 실패했습니다.");
    } finally {
      setTransformingAssetId(null);
    }
  }

  async function handleApprove(assetId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/curriculum/assets/${assetId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "승인에 실패했습니다.");
      await loadAssets();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "승인에 실패했습니다.");
    }
  }

  async function handleSaveDetail() {
    if (!detailDraft) return;
    setSavingDetail(true);
    setError(null);
    try {
      const res = await fetch(`/api/curriculum/assets/${detailDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: detailDraft.notes,
          lexileMin: detailDraft.lexileMin,
          lexileMax: detailDraft.lexileMax,
          passages: detailDraft.passages,
          questionSets: detailDraft.questionSets.map((set) => ({
            ...set,
            itemCount: detailDraft.questions.filter((question) => question.questionSetId === set.id).length,
          })),
          questions: detailDraft.questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "검토 저장에 실패했습니다.");
      await loadAssets();
      const refreshed = await fetch(`/api/curriculum/assets/${detailDraft.id}`, { cache: "no-store" });
      const refreshedData = await refreshed.json();
      if (!refreshed.ok) throw new Error(refreshedData.error ?? "저장 후 새로고침에 실패했습니다.");
      setAssetDetail(refreshedData.asset ?? null);
      setDetailDraft(refreshedData.asset ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "검토 저장에 실패했습니다.");
    } finally {
      setSavingDetail(false);
    }
  }

  function updateDraft(mutator: (current: CurriculumAssetDetail) => CurriculumAssetDetail) {
    setDetailDraft((current) => (current ? mutator(current) : current));
  }

  function nextDraftId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", background: "var(--color-bg)" }}>
      <aside style={{ borderRight: "1px solid var(--color-border)", background: "var(--color-surface)", padding: "20px", overflowY: "auto" }}>
        <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--color-text)", marginBottom: "8px" }}>커리큘럼 자료</div>
        <div style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6, marginBottom: "18px" }}>
          PDF/사진 자료를 올리고, 학기·레벨·과목·유형으로 분류한 뒤 AI가 지문/문항 구조로 변환하도록 관리합니다.
        </div>
        {error && (
          <div style={{ padding: "12px", borderRadius: "12px", border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.07)", color: "#b91c1c", fontSize: "13px", lineHeight: 1.6, marginBottom: "14px" }}>
            {error}
          </div>
        )}
        <div style={{ display: "grid", gap: "10px" }}>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>학기</span>
            <select value={semester} onChange={(e) => setSemester(e.target.value)} style={inputStyle}>
              <option value="">전체</option>
              {CURRICULUM_SEMESTERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>레벨</span>
            <input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="예: Wind1" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>과목</span>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle}>
              <option value="">전체</option>
              {CURRICULUM_SUBJECTS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>유형</span>
            <select value={contentType} onChange={(e) => setContentType(e.target.value)} style={inputStyle}>
              <option value="">전체</option>
              {CURRICULUM_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>상태</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              <option value="">전체</option>
              <option value="uploaded">uploaded</option>
              <option value="review_needed">review_needed</option>
              <option value="approved">approved</option>
            </select>
          </label>
        </div>
      </aside>

      <main style={{ minWidth: 0, minHeight: 0, overflowY: "auto", padding: "24px", display: "grid", gap: "18px" }}>
        <section style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-text)" }}>자료 업로드</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>원본 파일과 메타데이터를 먼저 저장한 뒤, `구조로 변환`으로 OCR/구조화 작업을 시작합니다.</div>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-subtle)" }}>로그인 사용자: {viewerId.slice(0, 8)}…</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: "12px" }}>
            <label style={{ display: "grid", gap: "6px", gridColumn: "span 2" }}>
              <span style={labelStyle}>자료명</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: Wind1 1학기 Reading Week 3" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>학기</span>
              <select value={semester} onChange={(e) => setSemester(e.target.value)} style={inputStyle}>
                <option value="">선택</option>
                {CURRICULUM_SEMESTERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>레벨</span>
              <input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="Wind1" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>과목</span>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle}>
                <option value="">선택</option>
                {CURRICULUM_SUBJECTS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>유형</span>
              <select value={contentType} onChange={(e) => setContentType(e.target.value)} style={inputStyle}>
                <option value="">선택</option>
                {CURRICULUM_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>Lexile 시작</span>
              <input value={lexileMin} onChange={(e) => setLexileMin(e.target.value)} placeholder="150" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={labelStyle}>Lexile 종료</span>
              <input value={lexileMax} onChange={(e) => setLexileMax(e.target.value)} placeholder="250" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: "6px", gridColumn: "span 2" }}>
              <span style={labelStyle}>메모</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="이 자료가 어떤 스타일인지 메모" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: "6px", gridColumn: "span 2" }}>
              <span style={labelStyle}>파일</span>
              <input type="file" accept=".pdf,.docx,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
            <button onClick={handleUpload} disabled={saving} style={primaryButtonStyle}>
              {saving ? "업로드 중..." : "자료 업로드"}
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(360px, 42%) minmax(0,1fr)", gap: "18px" }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-text)" }}>자료 목록</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-subtle)" }}>{loading ? "불러오는 중..." : `${assets.length}건`}</div>
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  style={{
                    textAlign: "left",
                    padding: "14px",
                    borderRadius: "16px",
                    border: `1px solid ${selectedAssetId === asset.id ? "var(--color-primary)" : "var(--color-border)"}`,
                    background: selectedAssetId === asset.id ? "rgba(79,70,229,0.05)" : "var(--color-surface)",
                    cursor: "pointer",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--color-text)" }}>{asset.title}</div>
                    <span style={badgeStyle(asset.status)}>{asset.status}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    {asset.semester} · {asset.levelName} · {asset.subject} · {asset.contentType}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-subtle)" }}>
                    지문 {asset.passageCount} · 문제세트 {asset.questionSetCount} · 문항 {asset.questionCount}
                  </div>
                  {asset.latestJobStatus && (
                    <div style={{ fontSize: "12px", color: asset.latestJobStatus === "failed" ? "#b91c1c" : "var(--color-text-subtle)" }}>
                      최근 변환: {asset.latestJobStatus}{asset.latestJobError ? ` · ${asset.latestJobError}` : ""}
                    </div>
                  )}
                </button>
              ))}
              {!loading && assets.length === 0 && (
                <div style={{ padding: "22px", borderRadius: "16px", border: "1px dashed var(--color-border-strong)", color: "var(--color-text-muted)", fontSize: "13px", textAlign: "center" }}>
                  아직 등록된 커리큘럼 자료가 없습니다.
                </div>
              )}
            </div>
          </div>

          <div style={panelStyle}>
            {selectedAsset ? (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
                  <div style={{ display: "grid", gap: "6px" }}>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text)" }}>{selectedAsset.title}</div>
                    <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                      {selectedAsset.semester} · {selectedAsset.levelName} · {selectedAsset.subject} · {selectedAsset.contentType}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--color-text-subtle)" }}>
                      Lexile {selectedAsset.lexileMin ?? "?"}L ~ {selectedAsset.lexileMax ?? "?"}L
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <a href={selectedAsset.fileUrl} target="_blank" rel="noreferrer" style={secondaryButtonStyle}>원본 보기</a>
                    <button
                      onClick={() => handleTransform(selectedAsset.id)}
                      disabled={transformingAssetId === selectedAsset.id}
                      style={secondaryButtonStyle}
                    >
                      {transformingAssetId === selectedAsset.id ? "변환 중..." : "구조로 변환"}
                    </button>
                    <button onClick={() => handleApprove(selectedAsset.id)} style={primaryButtonStyle}>승인</button>
                    <button onClick={handleSaveDetail} disabled={!detailDraft || savingDetail || loadingDetail} style={secondaryButtonStyle}>
                      {savingDetail ? "저장 중..." : "검토 저장"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "10px", marginBottom: "16px" }}>
                  <div style={metricCardStyle}>
                    <div style={metricLabelStyle}>지문</div>
                    <div style={metricValueStyle}>{selectedAsset.passageCount}</div>
                  </div>
                  <div style={metricCardStyle}>
                    <div style={metricLabelStyle}>문제세트</div>
                    <div style={metricValueStyle}>{selectedAsset.questionSetCount}</div>
                  </div>
                  <div style={metricCardStyle}>
                    <div style={metricLabelStyle}>문항</div>
                    <div style={metricValueStyle}>{selectedAsset.questionCount}</div>
                  </div>
                  <div style={metricCardStyle}>
                    <div style={metricLabelStyle}>최근 변환</div>
                    <div style={{ ...metricValueStyle, fontSize: "16px" }}>{selectedAsset.latestJobStatus ?? "-"}</div>
                  </div>
                </div>

                {loadingDetail ? (
                  <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>상세 자료를 불러오는 중...</div>
                ) : detailDraft ? (
                  <div style={{ display: "grid", gap: "16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "12px" }}>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={labelStyle}>Lexile 시작</span>
                        <input
                          value={detailDraft.lexileMin ?? ""}
                          onChange={(e) =>
                            updateDraft((current) => ({
                              ...current,
                              lexileMin: e.target.value.trim() ? Number(e.target.value) : null,
                            }))
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={labelStyle}>Lexile 종료</span>
                        <input
                          value={detailDraft.lexileMax ?? ""}
                          onChange={(e) =>
                            updateDraft((current) => ({
                              ...current,
                              lexileMax: e.target.value.trim() ? Number(e.target.value) : null,
                            }))
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={labelStyle}>메모</span>
                        <input
                          value={detailDraft.notes ?? ""}
                          onChange={(e) =>
                            updateDraft((current) => ({
                              ...current,
                              notes: e.target.value,
                            }))
                          }
                          style={inputStyle}
                        />
                      </label>
                    </div>

                    <section style={{ display: "grid", gap: "10px" }}>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--color-text)" }}>추출 텍스트</div>
                      <div style={{ display: "grid", gap: "10px" }}>
                        {detailDraft.pages.map((page) => (
                          <div key={page.id} style={{ padding: "12px", borderRadius: "14px", border: "1px solid var(--color-border)", background: "var(--color-bg)", display: "grid", gap: "8px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-subtle)" }}>페이지 {page.pageNumber}</div>
                            <textarea readOnly value={page.extractedText ?? ""} style={{ ...textareaStyle, minHeight: "120px", background: "var(--color-surface)" }} />
                          </div>
                        ))}
                        {detailDraft.pages.length === 0 && (
                          <div style={emptyStateStyle}>아직 추출된 페이지 텍스트가 없습니다.</div>
                        )}
                      </div>
                    </section>

                    <section style={{ display: "grid", gap: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--color-text)" }}>지문 검토</div>
                        <button
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              passages: [
                                ...current.passages,
                                {
                                  id: nextDraftId("passage"),
                                  title: "",
                                  body: "",
                                  lexileMin: current.lexileMin,
                                  lexileMax: current.lexileMax,
                                },
                              ],
                            }))
                          }
                          style={secondaryButtonStyle}
                        >
                          + 지문 추가
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: "10px" }}>
                        {detailDraft.passages.map((passage, index) => (
                          <div key={passage.id} style={editorCardStyle}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                              <div style={editorTitleStyle}>지문 {index + 1}</div>
                              <button
                                onClick={() =>
                                  updateDraft((current) => {
                                    const nextPassages = current.passages.filter((item) => item.id !== passage.id);
                                    const removedPassageSetIds = new Set(
                                      current.questionSets.filter((set) => set.passageId === passage.id).map((set) => set.id)
                                    );
                                    return {
                                      ...current,
                                      passages: nextPassages,
                                      questionSets: current.questionSets.filter((set) => set.passageId !== passage.id),
                                      questions: current.questions.filter((question) => !removedPassageSetIds.has(question.questionSetId)),
                                    };
                                  })
                                }
                                style={dangerButtonStyle}
                              >
                                삭제
                              </button>
                            </div>
                            <input
                              value={passage.title}
                              onChange={(e) =>
                                updateDraft((current) => ({
                                  ...current,
                                  passages: current.passages.map((item) =>
                                    item.id === passage.id ? { ...item, title: e.target.value } : item
                                  ),
                                }))
                              }
                              style={inputStyle}
                              placeholder="지문 제목"
                            />
                            <textarea
                              value={passage.body}
                              onChange={(e) =>
                                updateDraft((current) => ({
                                  ...current,
                                  passages: current.passages.map((item) =>
                                    item.id === passage.id ? { ...item, body: e.target.value } : item
                                  ),
                                }))
                              }
                              style={{ ...textareaStyle, minHeight: "160px" }}
                              placeholder="지문 본문"
                            />
                          </div>
                        ))}
                        {detailDraft.passages.length === 0 && (
                          <div style={emptyStateStyle}>아직 추출된 지문이 없습니다.</div>
                        )}
                      </div>
                    </section>

                    <section style={{ display: "grid", gap: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--color-text)" }}>문제세트/문항 검토</div>
                        <button
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              questionSets: [
                                ...current.questionSets,
                                {
                                  id: nextDraftId("set"),
                                  passageId: current.passages[0]?.id ?? null,
                                  sectionType: current.contentType.toLowerCase(),
                                  questionStyle: "",
                                  itemCount: 0,
                                  styleSummary: "",
                                },
                              ],
                            }))
                          }
                          style={secondaryButtonStyle}
                        >
                          + 문제세트 추가
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {detailDraft.questionSets.map((set, setIndex) => {
                          const questions = detailDraft.questions.filter((question) => question.questionSetId === set.id);
                          return (
                            <div key={set.id} style={editorCardStyle}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                                <div style={editorTitleStyle}>문제세트 {setIndex + 1}</div>
                                <button
                                  onClick={() =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questionSets: current.questionSets.filter((item) => item.id !== set.id),
                                      questions: current.questions.filter((question) => question.questionSetId !== set.id),
                                    }))
                                  }
                                  style={dangerButtonStyle}
                                >
                                  삭제
                                </button>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "10px" }}>
                                <select
                                  value={set.passageId ?? ""}
                                  onChange={(e) =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questionSets: current.questionSets.map((item) =>
                                        item.id === set.id ? { ...item, passageId: e.target.value || null } : item
                                      ),
                                    }))
                                  }
                                  style={inputStyle}
                                >
                                  <option value="">지문 연결 없음</option>
                                  {detailDraft.passages.map((passage, index) => (
                                    <option key={passage.id} value={passage.id}>
                                      지문 {index + 1}: {passage.title || "제목 없음"}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={set.sectionType}
                                  onChange={(e) =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questionSets: current.questionSets.map((item) =>
                                        item.id === set.id ? { ...item, sectionType: e.target.value } : item
                                      ),
                                    }))
                                  }
                                  style={inputStyle}
                                  placeholder="섹션 유형"
                                />
                                <input
                                  value={set.questionStyle ?? ""}
                                  onChange={(e) =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questionSets: current.questionSets.map((item) =>
                                        item.id === set.id ? { ...item, questionStyle: e.target.value } : item
                                      ),
                                    }))
                                  }
                                  style={inputStyle}
                                  placeholder="문항 스타일"
                                />
                                <input
                                  value={set.styleSummary ?? ""}
                                  onChange={(e) =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questionSets: current.questionSets.map((item) =>
                                        item.id === set.id ? { ...item, styleSummary: e.target.value } : item
                                      ),
                                    }))
                                  }
                                  style={inputStyle}
                                  placeholder="스타일 요약"
                                />
                              </div>
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <button
                                  onClick={() =>
                                    updateDraft((current) => ({
                                      ...current,
                                      questions: [
                                        ...current.questions,
                                        {
                                          id: nextDraftId("question"),
                                          questionSetId: set.id,
                                          questionType: "multiple_choice",
                                          prompt: "",
                                          choices: [],
                                          answer: "",
                                          explanation: "",
                                        },
                                      ],
                                    }))
                                  }
                                  style={secondaryButtonStyle}
                                >
                                  + 문항 추가
                                </button>
                              </div>
                              <div style={{ display: "grid", gap: "8px" }}>
                                {questions.map((question, questionIndex) => (
                                  <div key={question.id} style={{ padding: "10px", borderRadius: "12px", border: "1px solid var(--color-border)", background: "var(--color-surface)", display: "grid", gap: "8px" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                                      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-subtle)" }}>문항 {questionIndex + 1}</div>
                                      <button
                                        onClick={() =>
                                          updateDraft((current) => ({
                                            ...current,
                                            questions: current.questions.filter((item) => item.id !== question.id),
                                          }))
                                        }
                                        style={dangerButtonStyle}
                                      >
                                        삭제
                                      </button>
                                    </div>
                                    <input
                                      value={question.prompt}
                                      onChange={(e) =>
                                        updateDraft((current) => ({
                                          ...current,
                                          questions: current.questions.map((item) =>
                                            item.id === question.id ? { ...item, prompt: e.target.value } : item
                                          ),
                                        }))
                                      }
                                      style={inputStyle}
                                      placeholder="문항 내용"
                                    />
                                    <input
                                      value={question.choices.join(" | ")}
                                      onChange={(e) =>
                                        updateDraft((current) => ({
                                          ...current,
                                          questions: current.questions.map((item) =>
                                            item.id === question.id
                                              ? {
                                                  ...item,
                                                  choices: e.target.value
                                                    .split("|")
                                                    .map((choice) => choice.trim())
                                                    .filter(Boolean),
                                                }
                                              : item
                                          ),
                                        }))
                                      }
                                      style={inputStyle}
                                      placeholder="선택지: | 로 구분"
                                    />
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "8px" }}>
                                      <input
                                        value={question.answer ?? ""}
                                        onChange={(e) =>
                                          updateDraft((current) => ({
                                            ...current,
                                            questions: current.questions.map((item) =>
                                              item.id === question.id ? { ...item, answer: e.target.value } : item
                                            ),
                                          }))
                                        }
                                        style={inputStyle}
                                        placeholder="정답"
                                      />
                                      <input
                                        value={question.questionType}
                                        onChange={(e) =>
                                          updateDraft((current) => ({
                                            ...current,
                                            questions: current.questions.map((item) =>
                                              item.id === question.id ? { ...item, questionType: e.target.value } : item
                                            ),
                                          }))
                                        }
                                        style={inputStyle}
                                        placeholder="문항 유형"
                                      />
                                    </div>
                                    <textarea
                                      value={question.explanation ?? ""}
                                      onChange={(e) =>
                                        updateDraft((current) => ({
                                          ...current,
                                          questions: current.questions.map((item) =>
                                            item.id === question.id ? { ...item, explanation: e.target.value } : item
                                          ),
                                        }))
                                      }
                                      style={{ ...textareaStyle, minHeight: "88px" }}
                                      placeholder="해설"
                                    />
                                  </div>
                                ))}
                                {questions.length === 0 && (
                                  <div style={emptyStateStyle}>이 문제세트에는 아직 추출된 문항이 없습니다.</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {detailDraft.questionSets.length === 0 && (
                          <div style={emptyStateStyle}>아직 추출된 문제세트가 없습니다.</div>
                        )}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>상세 자료가 아직 없습니다.</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>자료를 선택하면 상세 정보가 표시됩니다.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "20px",
  padding: "20px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  fontSize: "13px",
  fontFamily: "inherit",
  color: "var(--color-text)",
  outline: "none",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid var(--color-primary)",
  background: "var(--color-primary)",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
};

const dangerButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(239,68,68,0.22)",
  background: "rgba(239,68,68,0.08)",
  color: "#b91c1c",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
};

const labelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--color-text)",
};

const metricCardStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  display: "grid",
  gap: "4px",
};

const metricLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--color-text-subtle)",
};

const metricValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  color: "var(--color-text)",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg)",
  fontSize: "13px",
  fontFamily: "inherit",
  color: "var(--color-text)",
  outline: "none",
  resize: "vertical",
};

const editorCardStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "16px",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  display: "grid",
  gap: "10px",
};

const editorTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--color-text)",
};

const emptyStateStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "12px",
  border: "1px dashed var(--color-border-strong)",
  background: "var(--color-surface)",
  fontSize: "13px",
  color: "var(--color-text-muted)",
  textAlign: "center",
};

function badgeStyle(status: string): CSSProperties {
  const palette =
    status === "approved"
      ? { border: "rgba(22,163,74,0.2)", background: "rgba(22,163,74,0.08)", color: "#15803d" }
      : status === "review_needed"
      ? { border: "rgba(217,119,6,0.22)", background: "rgba(217,119,6,0.08)", color: "#b45309" }
      : { border: "rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.08)", color: "#2563eb" };
  return {
    padding: "4px 8px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: "11px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}
