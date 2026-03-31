"use client";

import { useState, useEffect } from "react";
import { LessonPackage } from "@/lib/agents/types";

interface Project { id: string; name: string; }

interface SaveDialogProps {
  lessonPackage: LessonPackage | null;
  onClose: () => void;
  onSave: (projectId: string | null, lessonName: string, tags: string) => void;
}

export default function SaveDialog({ lessonPackage, onClose, onSave }: SaveDialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [lessonName, setLessonName] = useState(lessonPackage?.title ?? "");
  const [tags, setTags] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(({ projects }) => {
        setProjects(projects ?? []);
        if (projects?.[0]) setSelectedProjectId(projects[0].id);
      })
      .catch(() => {});
  }, []);

  function handleSave() {
    onSave(selectedProjectId, lessonName, tags);
    onClose();
  }

  return (
    <div
      onClick={onClose}
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
          <button onClick={onClose} style={{ width: "26px", height: "26px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>프로젝트</label>
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
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
              placeholder="레슨 이름 입력"
              style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--color-text)", marginBottom: "5px" }}>태그 (선택)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="환경, 초등, intermediate"
              style={{ width: "100%", padding: "8px 10px", borderRadius: "7px", border: "1.5px solid var(--color-border-strong)", fontSize: "13px", color: "var(--color-text)", background: "var(--color-surface)", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}>
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!lessonName.trim()}
            style={{
              padding: "7px 16px", borderRadius: "6px",
              background: lessonName.trim() ? "var(--color-primary)" : "var(--color-border-strong)",
              color: lessonName.trim() ? "#fff" : "var(--color-text-muted)",
              fontSize: "13px", fontWeight: "600",
              border: "none", cursor: lessonName.trim() ? "pointer" : "not-allowed",
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
