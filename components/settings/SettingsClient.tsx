"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentName, AIProvider } from "@/lib/agents/types";
import { AGENT_META, PIPELINE_ORDER } from "@/lib/agentMeta";
import { AppRole } from "@/lib/authz/roles";
import { DEFAULT_REVIEW_NOTE_TEMPLATES } from "@/lib/reviewTemplates";
import { DEFAULT_REVIEW_SLA_HOURS } from "@/lib/reviewSettings";
import {
  DEFAULT_IMAGE_PROMPT_PRESETS,
  ImagePromptPreset,
  ImagePromptReference,
} from "@/lib/imagePrompts";

type SettingsTab = "ai" | "agents" | "tokens" | "review" | "image_prompts" | "notifications" | "users" | "folders";

const TABS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "ai",      label: "AI 제공자",   icon: "🤖" },
  { key: "agents",  label: "에이전트 매트릭스", icon: "⚡" },
  { key: "tokens",  label: "토큰 관리",   icon: "🪙" },
  { key: "review",  label: "검토 기준",   icon: "📝" },
  { key: "image_prompts", label: "이미지 프롬프트", icon: "🖼️" },
  { key: "notifications", label: "알림", icon: "🔔" },
  { key: "users",   label: "사용자 관리", icon: "👥" },
  { key: "folders", label: "폴더 관리",   icon: "📁" },
];

// ─── Per-agent provider matrix ─────────────────────────────

type AgentProviderMap = Record<AgentName, AIProvider | "default">;

const PROVIDERS = [
  { value: AIProvider.CLAUDE,  label: "Claude",  color: "#D97706" },
  { value: AIProvider.GPT,     label: "GPT-4o",  color: "#10A37F" },
  { value: AIProvider.GEMINI,  label: "Gemini",  color: "#4285F4" },
];

function initAgentProviders(): AgentProviderMap {
  const m = {} as AgentProviderMap;
  for (const a of PIPELINE_ORDER) m[a] = "default";
  return m;
}

function createPromptId() {
  return `prompt-${Math.random().toString(36).slice(2, 10)}`;
}

function createPromptReferenceId() {
  return `ref-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SettingsClient({
  viewerRole,
  initialTab,
}: {
  viewerRole: AppRole;
  initialTab?: SettingsTab;
}) {
  const canManageReviewTemplates = viewerRole === "admin" || viewerRole === "lead_teacher";
  const visibleTabs = useMemo(() => {
    if (viewerRole === "admin") return TABS;
    if (viewerRole === "lead_teacher") {
      return TABS.filter((tab) => tab.key !== "users");
    }
    return TABS.filter((tab) => tab.key === "notifications");
  }, [viewerRole]);

  const [tab, setTab] = useState<SettingsTab>(initialTab ?? visibleTabs[0]?.key ?? "notifications");

  // AI provider settings
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>(AIProvider.CLAUDE);
  const [chatProvider, setChatProvider] = useState<AIProvider>(AIProvider.CLAUDE);
  const [agentProviders, setAgentProviders] = useState<AgentProviderMap>(initAgentProviders);

  // Token settings
  const [tokenLimit, setTokenLimit]       = useState(200000);
  const [warnMinutes, setWarnMinutes]     = useState(5);
  const [blockOnLimit, setBlockOnLimit]   = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reviewAlerts, setReviewAlerts] = useState(true);
  const [revisionAlerts, setRevisionAlerts] = useState(true);
  const [quietStartHour, setQuietStartHour] = useState(22);
  const [quietEndHour, setQuietEndHour] = useState(8);
  const [approvedTemplatesText, setApprovedTemplatesText] = useState(
    DEFAULT_REVIEW_NOTE_TEMPLATES.approved.join("\n")
  );
  const [revisionTemplatesText, setRevisionTemplatesText] = useState(
    DEFAULT_REVIEW_NOTE_TEMPLATES.needs_revision.join("\n")
  );
  const [reviewSlaHours, setReviewSlaHours] = useState(DEFAULT_REVIEW_SLA_HOURS);
  const [reviewTemplateStats, setReviewTemplateStats] = useState<{
    approved: { template: string; count: number }[];
    needs_revision: { template: string; count: number }[];
  }>({
    approved: [],
    needs_revision: [],
  });
  const [imagePrompts, setImagePrompts] = useState<ImagePromptPreset[]>(DEFAULT_IMAGE_PROMPT_PRESETS);
  const [imagePromptUploadError, setImagePromptUploadError] = useState<string | null>(null);
  const [uploadingReferenceId, setUploadingReferenceId] = useState<string | null>(null);

  // API key state
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    anthropic?: { hasKey: boolean; maskedKey?: string };
    openai?: { hasKey: boolean; maskedKey?: string };
    google?: { hasKey: boolean; maskedKey?: string };
  }>({});
  // Input drafts — empty string means "no change" on save
  const [anthropicKeyDraft, setAnthropicKeyDraft] = useState("");
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState("");
  const [googleKeyDraft, setGoogleKeyDraft] = useState("");

  // Save state
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usageSummary, setUsageSummary] = useState<{
    totalTokens: number;
    totalRequests: number;
    byProvider: {
      claude: { tokens: number; requests: number };
      gpt: { tokens: number; requests: number };
      gemini: { tokens: number; requests: number };
    };
  }>({
    totalTokens: 0,
    totalRequests: 0,
    byProvider: {
      claude: { tokens: 0, requests: 0 },
      gpt: { tokens: 0, requests: 0 },
      gemini: { tokens: 0, requests: 0 },
    },
  });

  // Load settings on mount
  useEffect(() => {
    refreshSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/usage/summary", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.summary) return;
        setUsageSummary({
          totalTokens: Number(data.summary.totalTokens ?? 0),
          totalRequests: Number(data.summary.totalRequests ?? 0),
          byProvider: {
            claude: {
              tokens: Number(data.summary.byProvider?.claude?.tokens ?? 0),
              requests: Number(data.summary.byProvider?.claude?.requests ?? 0),
            },
            gpt: {
              tokens: Number(data.summary.byProvider?.gpt?.tokens ?? 0),
              requests: Number(data.summary.byProvider?.gpt?.requests ?? 0),
            },
            gemini: {
              tokens: Number(data.summary.byProvider?.gemini?.tokens ?? 0),
              requests: Number(data.summary.byProvider?.gemini?.requests ?? 0),
            },
          },
        });
      })
      .catch(() => {});
  }, []);

  function applyLoadedSettings(data: { settings?: Record<string, unknown> | null; apiKeyStatus?: typeof apiKeyStatus }) {
    const settings = data?.settings;
    if (settings) {
      if (settings.defaultProvider !== undefined) setDefaultProvider(settings.defaultProvider as AIProvider);
      if (settings.chatProvider !== undefined) setChatProvider(settings.chatProvider as AIProvider);
      if (settings.agentProviders  !== undefined) setAgentProviders({ ...initAgentProviders(), ...(settings.agentProviders as Partial<AgentProviderMap>) });
      if (settings.tokenLimit      !== undefined) setTokenLimit(settings.tokenLimit as number);
      if (settings.warnMinutes     !== undefined) setWarnMinutes(settings.warnMinutes as number);
      if (settings.blockOnLimit    !== undefined) setBlockOnLimit(settings.blockOnLimit as boolean);
      if (settings.notificationsEnabled !== undefined) setNotificationsEnabled(settings.notificationsEnabled as boolean);
      if (settings.reviewAlerts    !== undefined) setReviewAlerts(settings.reviewAlerts as boolean);
      if (settings.revisionAlerts  !== undefined) setRevisionAlerts(settings.revisionAlerts as boolean);
      if (settings.quietStartHour  !== undefined) setQuietStartHour(settings.quietStartHour as number);
      if (settings.quietEndHour    !== undefined) setQuietEndHour(settings.quietEndHour as number);
    }
    if (data?.apiKeyStatus) {
      setApiKeyStatus(data.apiKeyStatus);
    }
  }

  async function refreshSettings() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      applyLoadedSettings(data);
    } catch {}
  }

  useEffect(() => {
    if (!canManageReviewTemplates) return;

    fetch("/api/system-settings/review-templates")
      .then((r) => r.json())
      .then(({ templates, slaHours }) => {
        if (!templates) return;
        if (Array.isArray(templates.approved)) {
          setApprovedTemplatesText(templates.approved.join("\n"));
        }
        if (Array.isArray(templates.needs_revision)) {
          setRevisionTemplatesText(templates.needs_revision.join("\n"));
        }
        if (slaHours !== undefined) {
          setReviewSlaHours(Number(slaHours));
        }
      })
      .catch(() => {});

    fetch("/api/system-settings/review-templates/stats")
      .then((r) => r.json())
      .then(({ stats }) => {
        if (!stats) return;
        setReviewTemplateStats({
          approved: Array.isArray(stats.approved) ? stats.approved : [],
          needs_revision: Array.isArray(stats.needs_revision) ? stats.needs_revision : [],
        });
      })
      .catch(() => {});

    fetch("/api/system-settings/image-prompts")
      .then((r) => r.json())
      .then(({ prompts }) => {
        if (!Array.isArray(prompts)) return;
        setImagePrompts(
          prompts.map((item: { id?: string; name?: string; prompt?: string }, index: number) => ({
            id: item.id ?? createPromptId(),
            name: item.name ?? `프롬프트 ${index + 1}`,
            prompt: item.prompt ?? "",
          }))
        );
      })
      .catch(() => {});
  }, [canManageReviewTemplates]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.key === tab)) {
      setTab(visibleTabs[0]?.key ?? "notifications");
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    if (!initialTab) return;
    if (visibleTabs.some((item) => item.key === initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab, visibleTabs]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const personalRes = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultProvider,
          chatProvider,
          agentProviders,
          tokenLimit,
          warnMinutes,
          blockOnLimit,
          notificationsEnabled,
          reviewAlerts,
          revisionAlerts,
          quietStartHour,
          quietEndHour,
          anthropicApiKey: anthropicKeyDraft || undefined,
          openaiApiKey:    openaiKeyDraft    || undefined,
          googleApiKey:    googleKeyDraft    || undefined,
        }),
      });
      const personalData = await personalRes.json();
      if (!personalRes.ok) throw new Error(personalData.error ?? "저장 실패");

      // Clear drafts after successful save and refresh status
      setAnthropicKeyDraft("");
      setOpenaiKeyDraft("");
      setGoogleKeyDraft("");
      await refreshSettings();

      if (canManageReviewTemplates) {
        const templates = {
          approved: approvedTemplatesText.split("\n").map((item) => item.trim()).filter(Boolean),
          needs_revision: revisionTemplatesText.split("\n").map((item) => item.trim()).filter(Boolean),
        };
        const normalizedImagePrompts = imagePrompts
          .map((item, index) => ({
            id: item.id || createPromptId(),
            name: item.name.trim() || `프롬프트 ${index + 1}`,
            prompt: item.prompt.trim(),
            references: (item.references ?? [])
              .map((reference, refIndex) => ({
                id: reference.id || createPromptReferenceId(),
                name: reference.name.trim() || `참조 이미지 ${refIndex + 1}`,
                url: reference.url.trim(),
                storagePath: reference.storagePath?.trim() || undefined,
                notes: reference.notes?.trim() || undefined,
              }))
              .filter((reference) => reference.url),
          }))
          .filter((item) => item.prompt);

        const sharedRes = await fetch("/api/system-settings/review-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templates, slaHours: reviewSlaHours }),
        });
        const sharedData = await sharedRes.json();
        if (!sharedRes.ok) throw new Error(sharedData.error ?? "검토 기준 저장 실패");

        const imagePromptRes = await fetch("/api/system-settings/image-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompts: normalizedImagePrompts }),
        });
        const imagePromptData = await imagePromptRes.json();
        if (!imagePromptRes.ok) throw new Error(imagePromptData.error ?? "이미지 프롬프트 저장 실패");

        setImagePrompts(normalizedImagePrompts);

        setReviewTemplateStats((prev) => ({
          approved: templates.approved.map((template) => ({
            template,
            count: prev.approved.find((item) => item.template === template)?.count ?? 0,
          })),
          needs_revision: templates.needs_revision.map((template) => ({
            template,
            count: prev.needs_revision.find((item) => item.template === template)?.count ?? 0,
          })),
        }));
      }

      setSaveMsg({ ok: true, text: "저장되었습니다." });
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  async function handleDeleteApiKey(field: "anthropicApiKey" | "openaiApiKey" | "googleApiKey") {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      await refreshSettings();
      setSaveMsg({ ok: true, text: "API 키가 삭제되었습니다." });
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  // Folder/project state (placeholder)
  const [folders] = useState([
    { id: "1", name: "2026년 초등부", code: "E26", count: 12 },
    { id: "2", name: "2026년 중등부", code: "M26", count: 8 },
    { id: "3", name: "2026년 고등부", code: "H26", count: 5 },
  ]);

  function Sidebar() {
    return (
      <aside style={{ width: "200px", flexShrink: 0, borderRight: "1px solid var(--color-border)", background: "var(--color-surface)", padding: "12px 8px" }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 10px", borderRadius: "6px", marginBottom: "2px",
              border: "none", cursor: "pointer", textAlign: "left",
              background: tab === t.key ? "var(--color-primary-light)" : "transparent",
              color: tab === t.key ? "var(--color-primary)" : "var(--color-text-muted)",
              fontSize: "13px", fontWeight: tab === t.key ? "600" : "400", transition: ".12s",
            }}
            onMouseOver={(e) => { if (tab !== t.key) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-bg)"; }}
            onMouseOut={(e)  => { if (tab !== t.key) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <span style={{ fontSize: "15px" }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </aside>
    );
  }

  function SaveFooter() {
    return (
      <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px" }}>
        {saveMsg && (
          <span style={{ fontSize: "12px", color: saveMsg.ok ? "#059669" : "#DC2626", fontWeight: "500" }}>
            {saveMsg.ok ? "✓ " : "✕ "}{saveMsg.text}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "8px 20px", borderRadius: "7px",
            background: saving ? "var(--color-border-strong)" : "var(--color-primary)",
            color: saving ? "var(--color-text-muted)" : "#fff",
            border: "none", fontSize: "13px", fontWeight: "600",
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    );
  }

  function addImagePromptPreset() {
    setImagePrompts((prev) => [
      ...prev,
      {
        id: createPromptId(),
        name: `프리셋 ${prev.length + 1}`,
        prompt: "",
        references: [],
      },
    ]);
  }

  function updateImagePromptPreset(id: string, patch: Partial<ImagePromptPreset>) {
    setImagePrompts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function removeImagePromptPreset(id: string) {
    setImagePrompts((prev) => prev.filter((item) => item.id !== id));
  }

  function moveImagePromptPreset(id: string, direction: "up" | "down") {
    setImagePrompts((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function addImagePromptReference(presetId: string) {
    setImagePrompts((prev) =>
      prev.map((item) =>
        item.id === presetId
          ? {
              ...item,
              references: [
                ...(item.references ?? []),
                {
                  id: createPromptReferenceId(),
                  name: `참조 이미지 ${(item.references?.length ?? 0) + 1}`,
                  url: "",
                  notes: "",
                },
              ],
            }
          : item
      )
    );
  }

  function updateImagePromptReference(
    presetId: string,
    referenceId: string,
    patch: Partial<ImagePromptReference>
  ) {
    setImagePrompts((prev) =>
      prev.map((item) =>
        item.id === presetId
          ? {
              ...item,
              references: (item.references ?? []).map((reference) =>
                reference.id === referenceId ? { ...reference, ...patch } : reference
              ),
            }
          : item
      )
    );
  }

  function removeImagePromptReference(presetId: string, referenceId: string) {
    setImagePrompts((prev) =>
      prev.map((item) =>
        item.id === presetId
          ? {
              ...item,
              references: (item.references ?? []).filter(
                (reference) => reference.id !== referenceId
              ),
            }
          : item
      )
    );
  }

  async function uploadImagePromptReference(
    presetId: string,
    referenceId: string,
    file: File
  ) {
    setImagePromptUploadError(null);
    setUploadingReferenceId(referenceId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/system-settings/image-prompts/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "참조 이미지 업로드 실패");
      }
      updateImagePromptReference(presetId, referenceId, {
        name: data.reference?.name || file.name,
        url: data.reference?.url || "",
        storagePath: data.reference?.storagePath || undefined,
      });
    } catch (error) {
      setImagePromptUploadError(
        error instanceof Error ? error.message : "참조 이미지 업로드 중 오류가 발생했습니다."
      );
    } finally {
      setUploadingReferenceId(null);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <Sidebar />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: "var(--color-bg)" }}>

        {/* ── AI 제공자 ── */}
        {tab === "ai" && (
          <div style={{ maxWidth: "640px" }}>
            <SectionTitle>AI 제공자 설정</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              레슨 생성과 채팅에 사용할 AI 서비스를 설정합니다.
            </p>

            <div style={{ marginBottom: "14px", padding: "10px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "7px", fontSize: "11px", color: "#1E40AF", lineHeight: "1.5" }}>
              ℹ️ API 키는 아래 입력란에 직접 저장하거나, Vercel 환경 변수(<code style={{ fontFamily: "monospace", fontSize: "11px" }}>ANTHROPIC_API_KEY</code>, <code style={{ fontFamily: "monospace", fontSize: "11px" }}>OPENAI_API_KEY</code>, <code style={{ fontFamily: "monospace", fontSize: "11px" }}>GOOGLE_API_KEY</code>)로 설정할 수 있습니다. 직접 저장한 키가 환경 변수보다 우선 사용됩니다.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {([
                { id: AIProvider.CLAUDE,  label: "Anthropic Claude", sub: "claude-opus-4-6", color: "#D97706", envKey: "ANTHROPIC_API_KEY", statusKey: "anthropic" as const, draft: anthropicKeyDraft, setDraft: setAnthropicKeyDraft, field: "anthropicApiKey" as const },
                { id: AIProvider.GPT,     label: "OpenAI GPT",       sub: "gpt-4o",          color: "#10A37F", envKey: "OPENAI_API_KEY",    statusKey: "openai"    as const, draft: openaiKeyDraft,    setDraft: setOpenaiKeyDraft,    field: "openaiApiKey"    as const },
                { id: AIProvider.GEMINI,  label: "Google Gemini",    sub: "gemini-1.5-pro",  color: "#4285F4", envKey: "GOOGLE_API_KEY",    statusKey: "google"    as const, draft: googleKeyDraft,    setDraft: setGoogleKeyDraft,    field: "googleApiKey"    as const },
              ]).map((p) => {
                const status = apiKeyStatus[p.statusKey];
                const hasKey = Boolean(status?.hasKey);
                return (
                  <Card key={p.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: p.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "13px", fontWeight: "700", flexShrink: 0 }}>
                        {p.label[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text)" }}>{p.label}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{p.sub}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="defaultProvider"
                            checked={defaultProvider === p.id}
                            onChange={() => setDefaultProvider(p.id)}
                          />
                          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>기본</span>
                        </label>
                      </div>
                    </div>

                    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>API 키</label>
                        {hasKey && (
                          <>
                            <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "#ECFDF5", color: "#059669", fontWeight: "600" }}>
                              ✓ 저장됨
                            </span>
                            <span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                              {status?.maskedKey}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteApiKey(p.field)}
                              disabled={saving}
                              style={{ marginLeft: "auto", fontSize: "10px", padding: "3px 8px", borderRadius: "4px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B91C1C", cursor: saving ? "not-allowed" : "pointer", fontWeight: "600" }}
                            >
                              지우기
                            </button>
                          </>
                        )}
                      </div>
                      <input
                        type="password"
                        value={p.draft}
                        onChange={(e) => p.setDraft(e.target.value)}
                        placeholder={hasKey ? "새 키 입력 (기존 키 유지하려면 비워두기)" : "새 키 입력"}
                        autoComplete="off"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--color-border-strong)",
                          fontSize: "12px",
                          fontFamily: "monospace",
                          outline: "none",
                          background: "var(--color-bg)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", lineHeight: 1.5 }}>
                        저장된 키는 Vercel 환경 변수보다 우선 사용됩니다. 비워두면 <code style={{ fontFamily: "monospace" }}>{p.envKey}</code> 환경 변수가 사용됩니다.
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text)", marginBottom: "6px" }}>
                채팅 AI 선택
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.5, marginBottom: "12px" }}>
                스튜디오 채팅과 에이전트 대화에 사용할 AI입니다. 이 채팅도 선택한 제공자의 API를 직접 호출하므로 사용량과 비용이 기록됩니다.
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {PROVIDERS.map((p) => {
                  const isSelected = chatProvider === p.value;
                  return (
                    <button
                      key={`chat-${p.value}`}
                      type="button"
                      onClick={() => setChatProvider(p.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${isSelected ? p.color : "var(--color-border)"}`,
                        background: isSelected ? `${p.color}15` : "var(--color-surface)",
                        color: isSelected ? p.color : "var(--color-text)",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </Card>

            <SaveFooter />
          </div>
        )}

        {/* ── 에이전트 매트릭스 ── */}
        {tab === "agents" && (
          <div style={{ maxWidth: "760px" }}>
            <SectionTitle>에이전트 매트릭스</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              16개 에이전트 각각에 사용할 AI 제공자를 지정합니다. "기본"은 AI 제공자 탭의 기본값을 따릅니다.
            </p>

            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "9px", overflow: "hidden" }}>
              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 120px 120px 120px 100px", padding: "8px 14px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                {["#", "에이전트", "Claude", "GPT-4o", "Gemini", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</div>
                ))}
              </div>

              {PIPELINE_ORDER.map((agent, idx) => {
                const m = AGENT_META[agent];
                const cur = agentProviders[agent];
                return (
                  <div
                    key={agent}
                    style={{
                      display: "grid", gridTemplateColumns: "40px 1fr 120px 120px 120px 100px",
                      padding: "9px 14px", borderBottom: idx < PIPELINE_ORDER.length - 1 ? "1px solid var(--color-border)" : "none",
                      alignItems: "center",
                      background: idx % 2 === 0 ? "var(--color-surface)" : "var(--color-bg)",
                    }}
                  >
                    <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", fontWeight: "600" }}>{m.num}</div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)" }}>{m.label}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>{m.tag}</div>
                    </div>
                    {([AIProvider.CLAUDE, AIProvider.GPT, AIProvider.GEMINI] as AIProvider[]).map((prov) => {
                      const pc = PROVIDERS.find((p) => p.value === prov)!;
                      const isSelected = cur === prov;
                      return (
                        <div key={prov} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <button
                            onClick={() => setAgentProviders((prev) => ({ ...prev, [agent]: isSelected ? "default" : prov }))}
                            style={{
                              width: "28px", height: "28px", borderRadius: "6px",
                              border: `1.5px solid ${isSelected ? pc.color : "var(--color-border)"}`,
                              background: isSelected ? pc.color : "transparent",
                              color: isSelected ? "#fff" : "var(--color-text-subtle)",
                              fontSize: "10px", fontWeight: "700", cursor: "pointer", transition: ".15s",
                            }}
                          >
                            {prov === AIProvider.CLAUDE ? "C" : prov === AIProvider.GPT ? "G" : "Ge"}
                          </button>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: "10px", color: cur === "default" ? "var(--color-text-subtle)" : "var(--color-primary)", textAlign: "center" }}>
                      {cur === "default" ? "기본값" : PROVIDERS.find((p) => p.value === cur)?.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => setAgentProviders(initAgentProviders)}
                style={{ fontSize: "12px", color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                전체 초기화
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {saveMsg && (
                  <span style={{ fontSize: "12px", color: saveMsg.ok ? "#059669" : "#DC2626", fontWeight: "500" }}>
                    {saveMsg.ok ? "✓ " : "✕ "}{saveMsg.text}
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: "8px 20px", borderRadius: "7px",
                    background: saving ? "var(--color-border-strong)" : "var(--color-primary)",
                    color: saving ? "var(--color-text-muted)" : "#fff",
                    border: "none", fontSize: "13px", fontWeight: "600",
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 토큰 관리 ── */}
        {tab === "tokens" && (
          <div style={{ maxWidth: "520px" }}>
            <SectionTitle>토큰 관리</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              API 토큰 사용량 제한과 경고 기준을 설정합니다.
            </p>

            <Card>
              <SettingRow label="월간 토큰 한도" sub="한도 초과 시 사용자 확인 후 진행">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="number"
                    value={tokenLimit}
                    onChange={(e) => setTokenLimit(Number(e.target.value))}
                    style={{ width: "110px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border-strong)", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>토큰</span>
                </div>
              </SettingRow>

              <Divider />

              <SettingRow label="장시간 작업 경고" sub="예상 소요 시간이 N분 이상이면 시작 전 보고">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="number"
                    value={warnMinutes}
                    onChange={(e) => setWarnMinutes(Number(e.target.value))}
                    style={{ width: "60px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border-strong)", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>분 이상</span>
                </div>
              </SettingRow>

              <Divider />

              <SettingRow label="한도 초과 시 자동 차단" sub="한도 도달 시 사용자 확인 없이 실행 중단">
                <Toggle value={blockOnLimit} onChange={setBlockOnLimit} />
              </SettingRow>
            </Card>

            {/* Usage summary placeholder */}
            <Card style={{ marginTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)" }}>이번 달 사용량</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                  요청 {usageSummary.totalRequests}회 · 총 {usageSummary.totalTokens.toLocaleString("ko-KR")} 토큰
                </div>
              </div>
              <UsageBar label={`Claude · ${usageSummary.byProvider.claude.requests}회`} used={usageSummary.byProvider.claude.tokens} total={tokenLimit} color="#D97706" />
              <UsageBar label={`GPT-4o · ${usageSummary.byProvider.gpt.requests}회`} used={usageSummary.byProvider.gpt.tokens} total={tokenLimit} color="#10A37F" style={{ marginTop: "8px" }} />
              <UsageBar label={`Gemini · ${usageSummary.byProvider.gemini.requests}회`} used={usageSummary.byProvider.gemini.tokens} total={tokenLimit} color="#4285F4" style={{ marginTop: "8px" }} />
            </Card>

            <SaveFooter />
          </div>
        )}

        {/* ── 검토 기준 ── */}
        {tab === "review" && canManageReviewTemplates && (
          <div style={{ maxWidth: "720px" }}>
            <SectionTitle>검토 기준 템플릿</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              검토함, 카드 인라인 액션, 상세 패널에서 공통으로 쓰는 승인/수정 요청 문구입니다. 한 줄에 하나씩 입력하면 팀 전체 기본 템플릿으로 반영됩니다.
            </p>

            <Card>
              <div style={{ display: "grid", gap: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>
                    검토 SLA 기준
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={reviewSlaHours}
                      onChange={(e) => setReviewSlaHours(Number(e.target.value))}
                      style={{
                        width: "88px",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-strong)",
                        fontSize: "13px",
                        fontFamily: "inherit",
                        background: "var(--color-bg)",
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>시간</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                    이 시간을 넘긴 검토는 작업함과 자료실에서 지연 경고로 표시됩니다.
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>
                    승인 템플릿
                  </label>
                  <textarea
                    value={approvedTemplatesText}
                    onChange={(e) => setApprovedTemplatesText(e.target.value)}
                    rows={5}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-strong)",
                      fontSize: "13px",
                      lineHeight: 1.6,
                      resize: "vertical",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      background: "var(--color-bg)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>
                    수정 요청 템플릿
                  </label>
                  <textarea
                    value={revisionTemplatesText}
                    onChange={(e) => setRevisionTemplatesText(e.target.value)}
                    rows={5}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-strong)",
                      fontSize: "13px",
                      lineHeight: 1.6,
                      resize: "vertical",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      background: "var(--color-bg)",
                    }}
                  />
                </div>
              </div>
            </Card>

            <Card style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>운영 팁</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                승인 템플릿은 바로 수업에 투입해도 되는 기준을 짧고 명확하게,
                수정 요청 템플릿은 강사가 다음 액션을 바로 알 수 있게 쓰는 편이 가장 효율적입니다.
              </div>
            </Card>

            <Card style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "10px" }}>최근 템플릿 사용 현황</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#3730A3", marginBottom: "8px" }}>승인 템플릿</div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {reviewTemplateStats.approved.length === 0 ? (
                      <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>아직 사용 기록이 없습니다.</div>
                    ) : (
                      reviewTemplateStats.approved.map((item) => (
                        <div key={`approved-stat-${item.template}`} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px", color: "var(--color-text-muted)" }}>
                          <span style={{ flex: 1 }}>{item.template}</span>
                          <span style={{ fontWeight: "700", color: "var(--color-text)" }}>{item.count}회</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#92400E", marginBottom: "8px" }}>수정 요청 템플릿</div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {reviewTemplateStats.needs_revision.length === 0 ? (
                      <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>아직 사용 기록이 없습니다.</div>
                    ) : (
                      reviewTemplateStats.needs_revision.map((item) => (
                        <div key={`revision-stat-${item.template}`} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px", color: "var(--color-text-muted)" }}>
                          <span style={{ flex: 1 }}>{item.template}</span>
                          <span style={{ fontWeight: "700", color: "var(--color-text)" }}>{item.count}회</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <SaveFooter />
          </div>
        )}

        {tab === "image_prompts" && canManageReviewTemplates && (
          <div style={{ maxWidth: "720px" }}>
            <SectionTitle>이미지 프롬프트 프리셋</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px", lineHeight: 1.7 }}>
              이미지 생성 시 기본으로 불러올 프롬프트를 팀 공용 프리셋으로 관리합니다. 템플릿 이미지 블록과 생성 화면 드롭다운은 여기서 저장한 순서대로 불러옵니다.
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "12px", color: "var(--color-text-subtle)" }}>
                현재 {imagePrompts.length}개의 프리셋이 있습니다. 위에서 아래 순서대로 드롭다운에 표시됩니다.
              </div>
              <button
                type="button"
                onClick={addImagePromptPreset}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                + 프리셋 추가
              </button>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              {imagePrompts.map((preset, index) => (
                <Card key={preset.id}>
                  <div style={{ display: "grid", gap: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)" }}>
                        프리셋 {index + 1}
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => moveImagePromptPreset(preset.id, "up")}
                          disabled={index === 0}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-text)",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: index === 0 ? "not-allowed" : "pointer",
                            opacity: index === 0 ? 0.5 : 1,
                          }}
                        >
                          위로
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImagePromptPreset(preset.id, "down")}
                          disabled={index === imagePrompts.length - 1}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-text)",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: index === imagePrompts.length - 1 ? "not-allowed" : "pointer",
                            opacity: index === imagePrompts.length - 1 ? 0.5 : 1,
                          }}
                        >
                          아래로
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImagePromptPreset(preset.id)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "8px",
                            border: "1px solid #FECACA",
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: "pointer",
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>프리셋명</label>
                      <input
                        value={preset.name}
                        onChange={(e) => updateImagePromptPreset(preset.id, { name: e.target.value })}
                        placeholder="예: 스토리북 일러스트"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: "10px",
                          border: "1px solid var(--color-border-strong)",
                          fontSize: "13px",
                          boxSizing: "border-box",
                          background: "var(--color-bg)",
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>프롬프트</label>
                      <textarea
                        value={preset.prompt}
                        onChange={(e) => updateImagePromptPreset(preset.id, { prompt: e.target.value })}
                        rows={5}
                        placeholder="이미지 생성 시 기본으로 사용할 프롬프트를 입력하세요."
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          borderRadius: "10px",
                          border: "1px solid var(--color-border-strong)",
                          fontSize: "13px",
                          lineHeight: 1.6,
                          resize: "vertical",
                          boxSizing: "border-box",
                          fontFamily: "inherit",
                          background: "var(--color-bg)",
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text)" }}>
                            참조 이미지
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "4px", lineHeight: 1.6 }}>
                            선택사항입니다. 이미지 URL과 참고 메모를 넣어두면 생성 시 해당 이미지를 참고하도록 함께 전달합니다.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addImagePromptReference(preset.id)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-text)",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: "pointer",
                          }}
                        >
                          + 참조 이미지
                        </button>
                      </div>

                      {imagePromptUploadError && (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px solid #FECACA",
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            fontSize: "11px",
                            lineHeight: 1.5,
                          }}
                        >
                          {imagePromptUploadError}
                        </div>
                      )}

                      {(preset.references ?? []).length === 0 ? (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px dashed var(--color-border-strong)",
                            fontSize: "11px",
                            color: "var(--color-text-subtle)",
                            background: "var(--color-bg)",
                          }}
                        >
                          아직 참조 이미지가 없습니다. 필요하면 URL과 설명을 추가해 주세요.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: "10px" }}>
                          {(preset.references ?? []).map((reference, refIndex) => (
                            <div
                              key={reference.id}
                              style={{
                                display: "grid",
                                gap: "8px",
                                padding: "12px",
                                borderRadius: "10px",
                                border: "1px solid var(--color-border)",
                                background: "var(--color-bg)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>
                                  참조 이미지 {refIndex + 1}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeImagePromptReference(preset.id, reference.id)}
                                  style={{
                                    padding: "6px 9px",
                                    borderRadius: "8px",
                                    border: "1px solid #FECACA",
                                    background: "#FEF2F2",
                                    color: "#B91C1C",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    cursor: "pointer",
                                  }}
                                >
                                  삭제
                                </button>
                              </div>

                              <input
                                value={reference.name}
                                onChange={(e) =>
                                  updateImagePromptReference(preset.id, reference.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="예: 우주 배경 참고"
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--color-border-strong)",
                                  fontSize: "13px",
                                  boxSizing: "border-box",
                                  background: "#fff",
                                }}
                              />

                              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                <label
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "8px 10px",
                                    borderRadius: "8px",
                                    border: "1px solid var(--color-border)",
                                    background: "#fff",
                                    color: "var(--color-text)",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    cursor: uploadingReferenceId === reference.id ? "not-allowed" : "pointer",
                                    opacity: uploadingReferenceId === reference.id ? 0.6 : 1,
                                  }}
                                >
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    disabled={uploadingReferenceId === reference.id}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        void uploadImagePromptReference(preset.id, reference.id, file);
                                      }
                                      e.currentTarget.value = "";
                                    }}
                                  />
                                  {uploadingReferenceId === reference.id ? "업로드 중..." : "로컬 이미지 업로드"}
                                </label>
                                <span style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                                  URL 직접 입력 대신 로컬에서 올려 바로 참조 이미지로 쓸 수 있습니다.
                                </span>
                              </div>

                              <input
                                value={reference.url}
                                onChange={(e) =>
                                  updateImagePromptReference(preset.id, reference.id, {
                                    url: e.target.value,
                                  })
                                }
                                placeholder="참조 이미지 URL"
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--color-border-strong)",
                                  fontSize: "13px",
                                  boxSizing: "border-box",
                                  background: "#fff",
                                }}
                              />

                              {reference.url ? (
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "120px minmax(0, 1fr)",
                                    gap: "10px",
                                    alignItems: "start",
                                  }}
                                >
                                  <img
                                    src={reference.url}
                                    alt={reference.name || `참조 이미지 ${refIndex + 1}`}
                                    style={{
                                      width: "120px",
                                      aspectRatio: "4 / 3",
                                      objectFit: "cover",
                                      borderRadius: "10px",
                                      border: "1px solid var(--color-border)",
                                      background: "#fff",
                                    }}
                                  />
                                  <div style={{ display: "grid", gap: "4px", fontSize: "11px", color: "var(--color-text-subtle)" }}>
                                    <div>
                                      {reference.storagePath
                                        ? "업로드된 파일을 참조 이미지로 사용합니다."
                                        : "외부 URL 이미지를 참조 이미지로 사용합니다."}
                                    </div>
                                    <div style={{ wordBreak: "break-all" }}>{reference.url}</div>
                                  </div>
                                </div>
                              ) : null}

                              <textarea
                                value={reference.notes ?? ""}
                                onChange={(e) =>
                                  updateImagePromptReference(preset.id, reference.id, {
                                    notes: e.target.value,
                                  })
                                }
                                rows={3}
                                placeholder="이 참조 이미지에서 어떤 느낌을 참고해야 하는지 적어주세요."
                                style={{
                                  width: "100%",
                                  padding: "12px 14px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--color-border-strong)",
                                  fontSize: "13px",
                                  lineHeight: 1.6,
                                  resize: "vertical",
                                  boxSizing: "border-box",
                                  fontFamily: "inherit",
                                  background: "#fff",
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "8px" }}>사용 흐름</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.8 }}>
                1. 여기서 프리셋을 추가하고 순서를 정합니다.
                <br />
                2. 템플릿 관리의 이미지 블록에서 기본 프리셋을 선택합니다.
                <br />
                3. 실제 이미지 생성 시 이 프리셋과 참조 이미지가 자동으로 불러와지고, 필요하면 생성 직전에 프롬프트를 수정할 수 있습니다.
              </div>
            </Card>

            <SaveFooter />
          </div>
        )}

        {/* ── 알림 ── */}
        {tab === "notifications" && (
          <div style={{ maxWidth: "560px" }}>
            <SectionTitle>알림 설정</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              새 검토 요청이나 수정 요청이 생겼을 때 상단 알림 배지와 토스트를 어떻게 보여줄지 설정합니다.
            </p>

            <Card>
              <SettingRow label="인앱 알림 사용" sub="상단 배지와 토스트 알림을 활성화합니다.">
                <Toggle value={notificationsEnabled} onChange={setNotificationsEnabled} />
              </SettingRow>

              <Divider />

              <SettingRow label="검토 요청 알림" sub="내 검토함에 새 레슨이 들어오면 즉시 알려줍니다.">
                <Toggle value={reviewAlerts} onChange={setReviewAlerts} />
              </SettingRow>

              <Divider />

              <SettingRow label="수정 요청 알림" sub="내 레슨이 수정 필요 상태가 되면 바로 알려줍니다.">
                <Toggle value={revisionAlerts} onChange={setRevisionAlerts} />
              </SettingRow>
            </Card>

            <Card style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "12px" }}>조용한 시간대</div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietStartHour}
                  onChange={(e) => setQuietStartHour(Number(e.target.value))}
                  style={{ width: "64px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border-strong)", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                />
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>시부터</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietEndHour}
                  onChange={(e) => setQuietEndHour(Number(e.target.value))}
                  style={{ width: "64px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border-strong)", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                />
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>시까지</span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "8px", lineHeight: 1.6 }}>
                조용한 시간대에는 배지는 유지하고, 새 토스트 알림만 띄우지 않습니다.
              </div>
            </Card>

            <SaveFooter />
          </div>
        )}

        {/* ── 사용자 관리 ── */}
        {tab === "users" && (
          <div style={{ maxWidth: "600px" }}>
            <SectionTitle>사용자 관리</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              선생님 계정을 초대하고 관리합니다. (관리자 전용)
            </p>

            <Card>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "10px" }}>새 선생님 초대</div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="email"
                  placeholder="이메일 주소"
                  style={{ flex: 1, padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--color-border-strong)", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                />
                <button style={{ padding: "8px 16px", borderRadius: "7px", background: "var(--color-primary)", color: "#fff", border: "none", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                  초대
                </button>
              </div>
            </Card>

            <Card style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "10px" }}>등록된 사용자</div>
              {[
                { name: "Kyle (나)", email: "cyjkyle@gmail.com", role: "admin", status: "active" },
                { name: "선생님 A",   email: "teacher_a@school.com", role: "teacher", status: "active" },
                { name: "선생님 B",   email: "teacher_b@school.com", role: "teacher", status: "invited" },
              ].map((u) => (
                <div key={u.email} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: u.role === "admin" ? "var(--color-primary)" : "#64748B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", flexShrink: 0 }}>
                    {u.name[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text)" }}>{u.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{u.email}</div>
                  </div>
                  <span style={{
                    fontSize: "10px", padding: "2px 7px", borderRadius: "4px", fontWeight: "600",
                    background: u.role === "admin" ? "var(--color-primary-light)" : "var(--color-bg)",
                    color: u.role === "admin" ? "var(--color-primary)" : "var(--color-text-muted)",
                    border: `1px solid ${u.role === "admin" ? "#C7D2FE" : "var(--color-border)"}`,
                  }}>
                    {u.role === "admin" ? "관리자" : "선생님"}
                  </span>
                  <span style={{
                    fontSize: "10px", padding: "2px 7px", borderRadius: "4px",
                    background: u.status === "active" ? "#ECFDF5" : "#FFF7ED",
                    color: u.status === "active" ? "#059669" : "#D97706",
                  }}>
                    {u.status === "active" ? "활성" : "초대됨"}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── 폴더 관리 ── */}
        {tab === "folders" && (
          <div style={{ maxWidth: "540px" }}>
            <SectionTitle>폴더 관리</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              레슨을 분류할 프로젝트 폴더와 코드값을 관리합니다.
            </p>

            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)" }}>프로젝트 목록</div>
                <button style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "5px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", color: "var(--color-text-muted)" }}>
                  + 새 폴더
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 60px", gap: "0", fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)", padding: "0 8px 6px", textTransform: "uppercase", letterSpacing: ".4px" }}>
                {["이름", "코드값", "레슨 수", ""].map((h) => <div key={h}>{h}</div>)}
              </div>

              {folders.map((f) => (
                <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 60px", padding: "8px 8px", borderTop: "1px solid var(--color-border)", alignItems: "center" }}>
                  <div style={{ fontSize: "13px", color: "var(--color-text)" }}>📁 {f.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>{f.code}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{f.count}</div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "4px", border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-text-muted)" }}>수정</button>
                  </div>
                </div>
              ))}
            </Card>

            <SaveFooter />
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Shared UI helpers ────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text)", marginBottom: "6px" }}>{children}</h2>;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "9px", padding: "16px", ...style }}>
      {children}
    </div>
  );
}

function SettingRow({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
      <div>
        <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text)" }}>{label}</div>
        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "2px" }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: "var(--color-border)", margin: "10px 0" }} />;
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: "40px", height: "22px", borderRadius: "11px",
        background: value ? "var(--color-primary)" : "var(--color-border-strong)",
        border: "none", cursor: "pointer", position: "relative", transition: "background .2s", flexShrink: 0,
      }}
    >
      <div style={{
        width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
        position: "absolute", top: "3px", left: value ? "21px" : "3px", transition: "left .2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

// SaveBtn은 SettingsClient 안에서 클로저로 접근하므로 외부 컴포넌트 아님

function UsageBar({ label, used, total, color, style: s }: { label: string; used: number; total: number; color: string; style?: React.CSSProperties }) {
  const pct = Math.min((used / total) * 100, 100);
  return (
    <div style={s}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text)" }}>{label}</span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{(used / 1000).toFixed(1)}K / {(total / 1000).toFixed(0)}K</span>
      </div>
      <div style={{ height: "6px", borderRadius: "3px", background: "var(--color-bg)", overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: "3px", background: color, width: `${pct}%`, transition: "width .4s" }} />
      </div>
    </div>
  );
}
