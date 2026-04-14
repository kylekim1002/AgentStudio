"use client";

import { useState, useEffect } from "react";
import { LessonPackage } from "@/lib/agents/types";
import { LessonReviewerOption, LessonStatus } from "@/lib/collab/lesson";

interface Project { id: string; name: string; }

interface SaveDialogProps {
  lessonPackage: LessonPackage | null;
  selectedTemplateName?: string;
  onClose: () => void;
  onSave: (
    projectId: string | null,
    lessonName: string,
    tags: string,
    status: LessonStatus,
    reviewerId: string | null
  ) => Promise<void>;
}

export default function SaveDialog({ lessonPackage, selectedTemplateName, onClose, onSave }: SaveDialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviewers, setReviewers] = useState<LessonReviewerOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState<string | null>(null);
  const [lessonName, setLessonName] = useState(lessonPackage?.title ?? "");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<LessonStatus>("draft");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const recommendedReviewer = reviewers.find((reviewer) => reviewer.isRecommended) ?? null;
  const selectedReviewer =
    selectedReviewerId ? reviewers.find((reviewer) => reviewer.id === selectedReviewerId) ?? null : null;
  const shouldWarnOnManualSelection =
    status === "in_review" &&
    selectedReviewer !== null &&
    recommendedReviewer !== null &&
    selectedReviewer.id !== recommendedReviewer.id &&
    ((selectedReviewer.overdueCount ?? 0) > 0 ||
      (selectedReviewer.queueCount ?? 0) > (recommendedReviewer.queueCount ?? 0));
  const canSubmit =
    !saving &&
    !!lessonName.trim() &&
    !(status === "in_review" && reviewers.length === 0);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(({ projects }) => {
        setProjects(projects ?? []);
        if (projects?.[0]) setSelectedProjectId(projects[0].id);
      })
      .catch(() => {});

    fetch("/api/reviewers")
      .then((r) => r.json())
      .then(({ reviewers }) => {
        setReviewers(reviewers ?? []);
        setSelectedReviewerId(null);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(
        selectedProjectId,
        lessonName,
        tags,
        status,
        status === "in_review" ? selectedReviewerId : null
      );
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "레슨 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={() => {
        if (!saving) onClose();
      }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)", borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
          width: "380px", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "15px", fontWeight: "700", color: "var(--color-text)" }}>레슨 저장</span>
          <button disabled={saving} onClick={onClose} style={{ width: "26px", height: "26px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-muted)", cursor: saving ? "not-allowed" : "pointer", fontSize: "16px", opacity: saving ? 0.5 : 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>프로젝트</label>
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
              disabled={saving}
              style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit" }}
            >
              <option value="">프로젝트 없음</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>레슨 이름</label>
            <input
              value={lessonName}
              onChange={(e) => setLessonName(e.target.value)}
              disabled={saving}
              placeholder="레슨 이름 입력"
              style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>

          {selectedTemplateName && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)", marginBottom: "4px" }}>
                선택된 문서 템플릿
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {selectedTemplateName}
              </div>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>태그 (선택)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={saving}
              placeholder="환경, 초등, intermediate"
              style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>저장 방식</label>
            <div style={{ display: "flex", gap: "8px" }}>
              {[
                { value: "draft", label: "초안 저장" },
                { value: "in_review", label: "검토 요청" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value as LessonStatus)}
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    borderRadius: "7px",
                    border: `1.5px solid ${status === option.value ? "var(--color-primary)" : "var(--color-border-strong)"}`,
                    background: status === option.value ? "var(--color-primary-light)" : "var(--color-surface)",
                    color: status === option.value ? "var(--color-primary)" : "var(--color-text-muted)",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {status === "in_review" && (
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>검토 담당자</label>
              {reviewers.length === 0 && (
                <div
                  style={{
                    marginBottom: "8px",
                    padding: "10px 12px",
                    borderRadius: "9px",
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    fontSize: "11px",
                    color: "#B91C1C",
                    lineHeight: 1.6,
                  }}
                >
                  검토 요청을 처리할 검토자 계정이 없습니다. 관리자 또는 검토자 권한 계정을 먼저 설정해야 합니다.
                </div>
              )}
              {recommendedReviewer && (
                <div
                  style={{
                    marginBottom: "8px",
                    padding: "10px 12px",
                    borderRadius: "9px",
                    background: !selectedReviewerId ? "#DBEAFE" : "#EFF6FF",
                    border: !selectedReviewerId ? "1px solid #93C5FD" : "1px solid #BFDBFE",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "#1D4ED8" }}>
                      {!selectedReviewerId ? `자동 배정 예정: ${recommendedReviewer.name}` : `추천 검토자: ${recommendedReviewer.name}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedReviewerId(recommendedReviewer.id)}
                      disabled={saving}
                      style={{
                        padding: "5px 8px",
                        borderRadius: "999px",
                        border: "none",
                        background: "#DBEAFE",
                        color: "#1D4ED8",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: saving ? "not-allowed" : "pointer",
                        opacity: saving ? 0.5 : 1,
                      }}
                    >
                      추천으로 배정
                    </button>
                  </div>
                  <div style={{ fontSize: "11px", color: "#1E40AF", lineHeight: 1.6 }}>
                    {recommendedReviewer.recommendationReason}
                  </div>
                </div>
              )}
              <select
                value={selectedReviewerId ?? ""}
                onChange={(e) => setSelectedReviewerId(e.target.value || null)}
                disabled={saving}
                style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit" }}
              >
                <option value="">
                  {recommendedReviewer ? `추천 검토자 자동 배정 (${recommendedReviewer.name})` : "추천 검토자 자동 배정"}
                </option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.isRecommended ? "추천 · " : ""}{reviewer.name} · {reviewer.role}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                직접 고르지 않으면 서버가 현재 가장 여유 있는 검토자로 자동 배정합니다.
              </div>
              {selectedReviewer && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "9px 10px",
                    borderRadius: "8px",
                    background:
                      (selectedReviewer.overdueCount ?? 0) > 0
                        ? "#FEF2F2"
                        : "#F8FAFC",
                    border:
                      (selectedReviewer.overdueCount ?? 0) > 0
                        ? "1px solid #FECACA"
                        : "1px solid var(--color-border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color:
                        (selectedReviewer.overdueCount ?? 0) > 0
                          ? "#B91C1C"
                          : "var(--color-text)",
                      marginBottom: "4px",
                    }}
                  >
                    현재 선택: {selectedReviewer.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                    대기 {selectedReviewer.queueCount ?? 0}건
                    {typeof selectedReviewer.averageWaitHours === "number"
                      ? ` · 평균 ${selectedReviewer.averageWaitHours}시간`
                      : ""}
                    {(selectedReviewer.overdueCount ?? 0) > 0
                      ? ` · SLA 초과 ${selectedReviewer.overdueCount}건`
                      : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReviewerId(null)}
                    disabled={saving}
                    style={{
                      marginTop: "6px",
                      padding: "5px 8px",
                      borderRadius: "999px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text-muted)",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: saving ? "not-allowed" : "pointer",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    자동 배정으로 되돌리기
                  </button>
                </div>
              )}
              {shouldWarnOnManualSelection && recommendedReviewer && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "9px 10px",
                    borderRadius: "8px",
                    background: "#FFF7ED",
                    border: "1px solid #FED7AA",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#C2410C", marginBottom: "4px" }}>
                    더 적합한 검토자가 있습니다
                  </div>
                  <div style={{ fontSize: "11px", color: "#9A3412", lineHeight: 1.6, marginBottom: "6px" }}>
                    {recommendedReviewer.name} 쪽이 현재 더 여유 있습니다. 빠른 처리 기준이면 추천 검토자로 바꾸는 편이 좋습니다.
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReviewerId(recommendedReviewer.id)}
                    disabled={saving}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "999px",
                      border: "none",
                      background: "#FDBA74",
                      color: "#7C2D12",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: saving ? "not-allowed" : "pointer",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    추천 검토자로 변경
                  </button>
                </div>
              )}
              {reviewers.length > 0 && (
                <div style={{ marginTop: "8px", display: "grid", gap: "6px" }}>
                  {reviewers.slice(0, 3).map((reviewer) => (
                    <button
                      key={`reviewer-chip-${reviewer.id}`}
                      type="button"
                      onClick={() => setSelectedReviewerId(reviewer.id)}
                      disabled={saving}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        padding: "7px 9px",
                        borderRadius: "8px",
                        border: `1px solid ${selectedReviewerId === reviewer.id ? "var(--color-primary)" : "var(--color-border)"}`,
                        background: selectedReviewerId === reviewer.id ? "var(--color-primary-light)" : "var(--color-bg)",
                        color: selectedReviewerId === reviewer.id ? "var(--color-primary)" : "var(--color-text-muted)",
                        fontSize: "11px",
                        cursor: saving ? "not-allowed" : "pointer",
                        opacity: saving ? 0.5 : 1,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                        {reviewer.isRecommended && (
                          <span style={{ fontSize: "10px", fontWeight: "700", color: "#1D4ED8", background: "#DBEAFE", padding: "2px 6px", borderRadius: "999px", flexShrink: 0 }}>
                            추천
                          </span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {reviewer.name}
                        </span>
                      </span>
                      <span style={{ flexShrink: 0 }}>
                        대기 {reviewer.queueCount ?? 0}건
                        {typeof reviewer.averageWaitHours === "number" ? ` · 평균 ${reviewer.averageWaitHours}h` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {saveError && (
          <div
            style={{
              margin: "0 20px 12px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#B91C1C",
              fontSize: "12px",
              lineHeight: 1.5,
            }}
          >
            {saveError}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button disabled={saving} onClick={onClose} style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)", fontSize: "13px", fontWeight: "500", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1 }}>
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!canSubmit}
            style={{
              padding: "7px 16px", borderRadius: "6px",
              background: canSubmit ? "var(--color-primary)" : "var(--color-border-strong)",
              color: canSubmit ? "#fff" : "var(--color-text-muted)",
              fontSize: "13px", fontWeight: "600",
              border: "none", cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
