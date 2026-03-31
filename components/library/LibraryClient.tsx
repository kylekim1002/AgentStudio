"use client";

import { useEffect, useState, useCallback } from "react";
import { LessonPackage, DifficultyLevel } from "@/lib/agents/types";
import { downloadBlob, safeFilename } from "@/lib/export/downloadFile";

// ─── Types ───────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  created_at: string;
}

interface LessonSummary {
  id: string;
  title: string;
  difficulty: DifficultyLevel;
  provider: string;
  created_at: string;
  project_id: string | null;
  tags: string[];
  isFavorite: boolean;
}

// ─── Difficulty badge colours ────────────────────────────────

const DIFF_COLOR: Record<string, { bg: string; text: string }> = {
  beginner:         { bg: "#F0FDF4", text: "#16A34A" },
  elementary:       { bg: "#ECFDF5", text: "#059669" },
  intermediate:     { bg: "#EFF6FF", text: "#2563EB" },
  "upper-intermediate": { bg: "#F5F3FF", text: "#7C3AED" },
  advanced:         { bg: "#FFF7ED", text: "#D97706" },
};

const DIFF_LABEL: Record<string, string> = {
  beginner: "초급", elementary: "기초", intermediate: "중급",
  "upper-intermediate": "중상급", advanced: "고급",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

// ─── Component ───────────────────────────────────────────────

export default function LibraryClient() {
  const [projects, setProjects]         = useState<Project[]>([]);
  const [lessons, setLessons]           = useState<LessonSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null); // null = 전체
  const [selectedLesson, setSelectedLesson]   = useState<LessonSummary | null>(null);
  const [lessonDetail, setLessonDetail] = useState<LessonPackage | null>(null);
  const [search, setSearch]             = useState("");
  const [favOnly, setFavOnly]           = useState(false);
  const [loading, setLoading]           = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjName, setNewProjName]   = useState("");
  const [newProjCode, setNewProjCode]   = useState("");

  // ── Load projects ──────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const { projects } = await res.json();
      setProjects(projects ?? []);
    }
  }, []);

  // ── Load lessons ───────────────────────────────────────────
  const loadLessons = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedProject) params.set("project_id", selectedProject);
    if (search)          params.set("search", search);
    if (favOnly)         params.set("favorite", "true");

    const res = await fetch(`/api/lessons?${params}`);
    if (res.ok) {
      const { lessons } = await res.json();
      setLessons(lessons ?? []);
    }
    setLoading(false);
  }, [selectedProject, search, favOnly]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadLessons(); }, [loadLessons]);

  // ── Load lesson detail ─────────────────────────────────────
  async function selectLesson(lesson: LessonSummary) {
    setSelectedLesson(lesson);
    setLessonDetail(null);
    const res = await fetch(`/api/lessons/${lesson.id}`);
    if (res.ok) {
      const data = await res.json();
      // API returns { lesson: { package: {...}, ... } }
      setLessonDetail(data.lesson?.package ?? null);
    }
  }

  // ── Export lesson ──────────────────────────────────────────
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(type: "student" | "teacher", format: "pdf" | "docx") {
    if (!lessonDetail) return;
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      const fname = safeFilename(lessonDetail.title);
      const label = type === "teacher" ? "교사용" : "학생용";
      if (format === "pdf") {
        const { generatePdf } = await import("@/lib/export/generatePdf");
        const blob = await generatePdf(lessonDetail, type, "simple");
        downloadBlob(blob, `${fname}_${label}.pdf`);
      } else {
        const { generateDocx } = await import("@/lib/export/generateDocx");
        const blob = await generateDocx(lessonDetail, type);
        downloadBlob(blob, `${fname}_${label}.docx`);
      }
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(null);
    }
  }

  // ── Toggle favorite ────────────────────────────────────────
  async function toggleFav(lessonId: string, isFav: boolean) {
    await fetch(`/api/lessons/${lessonId}/favorite`, { method: isFav ? "DELETE" : "POST" });
    setLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, isFavorite: !isFav } : l));
  }

  // ── Create project ─────────────────────────────────────────
  async function createProject() {
    if (!newProjName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjName.trim(), code: newProjCode.trim() || null }),
    });
    if (res.ok) {
      await loadProjects();
      setShowNewProject(false);
      setNewProjName("");
      setNewProjCode("");
    }
  }

  const filteredLessons = lessons; // server-side filtering already applied

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* ── LEFT: Project tree ── */}
      <aside style={{
        width: "220px", flexShrink: 0,
        background: "var(--color-surface)", borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "11px 14px 9px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-subtle)", letterSpacing: ".5px", textTransform: "uppercase" }}>프로젝트</span>
          <button
            onClick={() => setShowNewProject(true)}
            title="새 프로젝트"
            style={{ width: "22px", height: "22px", borderRadius: "5px", border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text-muted)", fontSize: "16px", lineHeight: "1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >+</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {/* All */}
          <ProjectItem
            active={selectedProject === null}
            label="전체 레슨"
            count={lessons.length}
            onClick={() => setSelectedProject(null)}
            icon="📂"
          />
          <ProjectItem
            active={favOnly}
            label="즐겨찾기"
            count={lessons.filter((l) => l.isFavorite).length}
            onClick={() => { setFavOnly((v) => !v); setSelectedProject(null); }}
            icon="⭐"
          />

          {projects.length > 0 && (
            <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", padding: "10px 8px 4px", letterSpacing: ".3px", textTransform: "uppercase" }}>
              내 프로젝트
            </div>
          )}

          {projects.map((p) => (
            <ProjectItem
              key={p.id}
              active={selectedProject === p.id}
              label={p.name}
              code={p.code ?? undefined}
              count={lessons.filter((l) => l.project_id === p.id).length}
              onClick={() => { setSelectedProject(p.id); setFavOnly(false); }}
              icon="📁"
            />
          ))}
        </div>

        {/* New project form */}
        {showNewProject && (
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
            <input
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="프로젝트 이름"
              autoFocus
              style={{ width: "100%", padding: "6px 8px", borderRadius: "5px", border: "1px solid var(--color-border-strong)", fontSize: "12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "5px" }}
            />
            <input
              value={newProjCode}
              onChange={(e) => setNewProjCode(e.target.value)}
              placeholder="코드값 (선택)"
              style={{ width: "100%", padding: "6px 8px", borderRadius: "5px", border: "1px solid var(--color-border-strong)", fontSize: "12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "7px" }}
            />
            <div style={{ display: "flex", gap: "5px" }}>
              <button onClick={() => setShowNewProject(false)} style={{ flex: 1, padding: "5px", borderRadius: "5px", border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: "11px", cursor: "pointer", color: "var(--color-text-muted)" }}>취소</button>
              <button onClick={createProject} style={{ flex: 1, padding: "5px", borderRadius: "5px", border: "none", background: "var(--color-primary)", color: "#fff", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>만들기</button>
            </div>
          </div>
        )}
      </aside>

      {/* ── CENTER: Lesson cards ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg)" }}>
        {/* Search bar */}
        <div style={{ padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", background: "var(--color-bg)", border: "1px solid var(--color-border-strong)", borderRadius: "7px", padding: "6px 10px" }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="var(--color-text-subtle)" strokeWidth="1.3"/><path d="M9 9l3 3" stroke="var(--color-text-subtle)" strokeWidth="1.3" strokeLinecap="round"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="레슨 검색..."
              style={{ flex: 1, border: "none", background: "transparent", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "var(--color-text)" }}
            />
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            {filteredLessons.length}개
          </span>
        </div>

        {/* Cards */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "var(--color-text-muted)", fontSize: "13px" }}>
              불러오는 중...
            </div>
          ) : filteredLessons.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "200px", gap: "10px", color: "var(--color-text-muted)" }}>
              <div style={{ fontSize: "28px", opacity: .4 }}>📚</div>
              <div style={{ fontSize: "13px" }}>레슨이 없습니다</div>
              <div style={{ fontSize: "12px" }}>스튜디오에서 레슨을 만들고 저장하면 여기 표시됩니다</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
              {filteredLessons.map((lesson) => {
                const dc = DIFF_COLOR[lesson.difficulty] ?? DIFF_COLOR.intermediate;
                const isActive = selectedLesson?.id === lesson.id;
                return (
                  <div
                    key={lesson.id}
                    onClick={() => selectLesson(lesson)}
                    style={{
                      background: "var(--color-surface)",
                      border: `1.5px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                      borderRadius: "9px", padding: "14px",
                      cursor: "pointer", transition: "all .15s",
                      boxShadow: isActive ? "0 0 0 3px rgba(79,70,229,.1)" : undefined,
                    }}
                    onMouseOver={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-strong)"; }}
                    onMouseOut={(e)  => { if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text)", lineHeight: "1.4", flex: 1, paddingRight: "6px" }}>
                        {lesson.title}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFav(lesson.id, lesson.isFavorite); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", flexShrink: 0, opacity: lesson.isFavorite ? 1 : .3, transition: ".15s" }}
                        onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        onMouseOut={(e)  => { (e.currentTarget as HTMLButtonElement).style.opacity = lesson.isFavorite ? "1" : "0.3"; }}
                      >
                        ⭐
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "10px" }}>
                      <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: dc.bg, color: dc.text, fontWeight: "600" }}>
                        {DIFF_LABEL[lesson.difficulty] ?? lesson.difficulty}
                      </span>
                      <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                        {lesson.provider}
                      </span>
                    </div>

                    {lesson.tags?.length > 0 && (
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px" }}>
                        {lesson.tags.slice(0, 3).map((t) => (
                          <span key={t} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "var(--color-primary-light)", color: "var(--color-primary)" }}>#{t}</span>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                      {fmtDate(lesson.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Detail panel ── */}
      <aside style={{
        width: "320px", flexShrink: 0,
        background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {!selectedLesson ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", padding: "24px", color: "var(--color-text-muted)" }}>
            <div style={{ fontSize: "28px", opacity: .35 }}>📋</div>
            <div style={{ fontSize: "13px", textAlign: "center" }}>레슨을 선택하면<br/>상세 내용을 볼 수 있습니다</div>
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>{selectedLesson.title}</div>
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                {(() => {
                  const dc = DIFF_COLOR[selectedLesson.difficulty] ?? DIFF_COLOR.intermediate;
                  return <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: dc.bg, color: dc.text, fontWeight: "600" }}>{DIFF_LABEL[selectedLesson.difficulty] ?? selectedLesson.difficulty}</span>;
                })()}
                <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{selectedLesson.provider}</span>
                <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{fmtDate(selectedLesson.created_at)}</span>
              </div>
            </div>

            {/* Detail body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
              {!lessonDetail ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100px", color: "var(--color-text-muted)", fontSize: "12px" }}>불러오는 중...</div>
              ) : (
                <>
                  <DetailSection title="📖 지문" content={lessonDetail.passage} />
                  <DetailSection title={`❓ 독해 문제 (${lessonDetail.reading.questions.length}문항)`} content={lessonDetail.reading.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />
                  <DetailSection title={`📝 어휘 (${lessonDetail.vocabulary.words.length}단어)`} content={lessonDetail.vocabulary.words.map((w) => `• ${w.word}: ${w.definition}`).join("\n")} />
                  <DetailSection title="📐 문법 포인트" content={`${lessonDetail.grammar.focusPoint}\n\n${lessonDetail.grammar.explanation}`} />
                  <DetailSection title="✍️ 쓰기 과제" content={lessonDetail.writing.prompt} />
                  <DetailSection title={`📊 평가지 (${lessonDetail.assessment.totalPoints}점)`} content={lessonDetail.assessment.questions.map((q, i) => `Q${i + 1}. ${q.question}`).join("\n\n")} />
                </>
              )}
            </div>

            {/* Export buttons */}
            <div style={{ padding: "11px 14px", borderTop: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", marginBottom: "7px" }}>내보내기</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
                {([
                  { label: "학생용 PDF",  type: "student" as const, format: "pdf"  as const },
                  { label: "교사용 PDF",  type: "teacher" as const, format: "pdf"  as const },
                  { label: "학생용 DOCX", type: "student" as const, format: "docx" as const },
                  { label: "교사용 DOCX", type: "teacher" as const, format: "docx" as const },
                ]).map(({ label, type, format }) => {
                  const busy = exporting === `${type}-${format}`;
                  return (
                    <button
                      key={label}
                      disabled={!lessonDetail || !!exporting}
                      onClick={() => handleExport(type, format)}
                      style={{
                        padding: "7px 6px", borderRadius: "6px",
                        border: "1px solid var(--color-border)", background: "var(--color-surface)",
                        color: lessonDetail ? "var(--color-text-muted)" : "var(--color-text-subtle)",
                        fontSize: "10px", fontWeight: "500",
                        cursor: lessonDetail && !exporting ? "pointer" : "not-allowed",
                        transition: ".15s",
                      }}
                      onMouseOver={(e) => {
                        if (!lessonDetail || exporting) return;
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
                      {busy ? "⏳ 생성 중..." : label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function ProjectItem({ active, label, code, count, onClick, icon }: {
  active: boolean; label: string; code?: string; count: number; onClick: () => void; icon: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "6px 8px", borderRadius: "6px", cursor: "pointer", marginBottom: "1px",
        background: active ? "var(--color-primary-light)" : "transparent",
        transition: ".12s",
      }}
      onMouseOver={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg)"; }}
      onMouseOut={(e) =>  { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <span style={{ fontSize: "13px", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: "12px", color: active ? "var(--color-primary)" : "var(--color-text)", flex: 1, fontWeight: active ? "600" : "400", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
        {code && <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginLeft: "4px" }}>({code})</span>}
      </span>
      <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function DetailSection({ title, content }: { title: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "7px", overflow: "hidden", marginBottom: "8px" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "var(--color-surface)", borderBottom: open ? "1px solid var(--color-border)" : "none" }}>
        <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>{title}</span>
        <span style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ padding: "10px", fontSize: "11px", color: "var(--color-text-muted)", lineHeight: "1.7", whiteSpace: "pre-wrap", maxHeight: "160px", overflowY: "auto" }}>
          {content}
        </div>
      )}
    </div>
  );
}
