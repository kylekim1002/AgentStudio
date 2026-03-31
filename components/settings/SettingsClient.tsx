"use client";

import { useState, useEffect } from "react";
import { AgentName, AIProvider } from "@/lib/agents/types";
import { AGENT_META, PIPELINE_ORDER } from "@/lib/agentMeta";

type SettingsTab = "ai" | "agents" | "tokens" | "users" | "folders";

const TABS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "ai",      label: "AI 제공자",   icon: "🤖" },
  { key: "agents",  label: "에이전트 매트릭스", icon: "⚡" },
  { key: "tokens",  label: "토큰 관리",   icon: "🪙" },
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

export default function SettingsClient() {
  const [tab, setTab] = useState<SettingsTab>("ai");

  // AI provider settings
  const [useClaudeCode, setUseClaudeCode] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>(AIProvider.CLAUDE);
  const [agentProviders, setAgentProviders] = useState<AgentProviderMap>(initAgentProviders);

  // Token settings
  const [tokenLimit, setTokenLimit]       = useState(200000);
  const [warnMinutes, setWarnMinutes]     = useState(5);
  const [blockOnLimit, setBlockOnLimit]   = useState(true);

  // Save state
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ settings }) => {
        if (!settings) return;
        if (settings.useClaudeCode   !== undefined) setUseClaudeCode(settings.useClaudeCode);
        if (settings.defaultProvider !== undefined) setDefaultProvider(settings.defaultProvider);
        if (settings.agentProviders  !== undefined) setAgentProviders({ ...initAgentProviders(), ...settings.agentProviders });
        if (settings.tokenLimit      !== undefined) setTokenLimit(settings.tokenLimit);
        if (settings.warnMinutes     !== undefined) setWarnMinutes(settings.warnMinutes);
        if (settings.blockOnLimit    !== undefined) setBlockOnLimit(settings.blockOnLimit);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useClaudeCode, defaultProvider, agentProviders, tokenLimit, warnMinutes, blockOnLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      setSaveMsg({ ok: true, text: "저장되었습니다." });
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
        {TABS.map((t) => (
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

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <Sidebar />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: "var(--color-bg)" }}>

        {/* ── AI 제공자 ── */}
        {tab === "ai" && (
          <div style={{ maxWidth: "640px" }}>
            <SectionTitle>AI 제공자 설정</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              레슨 생성에 사용할 AI 서비스를 설정합니다.
            </p>

            {/* Claude Code subscription option */}
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: useClaudeCode ? "14px" : "0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "9px", background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "16px", fontWeight: "700" }}>C</div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text)" }}>Claude Code 구독</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "1px" }}>claude.ai/code 구독으로 사용 (API 키 불필요)</div>
                  </div>
                </div>
                <Toggle value={useClaudeCode} onChange={setUseClaudeCode} />
              </div>
              {useClaudeCode && (
                <div style={{ padding: "10px 12px", background: "var(--color-primary-light)", borderRadius: "6px", fontSize: "12px", color: "var(--color-primary)" }}>
                  ✓ Claude Code 구독 모드가 활성화되었습니다. 아래 API 키 설정은 무시됩니다.
                </div>
              )}
            </Card>

            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[
                { id: AIProvider.CLAUDE,  label: "Anthropic Claude", sub: "claude-opus-4-6", color: "#D97706", envKey: "ANTHROPIC_API_KEY" },
                { id: AIProvider.GPT,     label: "OpenAI GPT",       sub: "gpt-4o",          color: "#10A37F", envKey: "OPENAI_API_KEY" },
                { id: AIProvider.GEMINI,  label: "Google Gemini",    sub: "gemini-1.5-pro",  color: "#4285F4", envKey: "GOOGLE_AI_API_KEY" },
              ].map((p) => (
                <Card key={p.id} style={{ opacity: useClaudeCode ? 0.45 : 1, pointerEvents: useClaudeCode ? "none" : undefined }}>
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
                          disabled={useClaudeCode}
                        />
                        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>기본</span>
                      </label>
                    </div>
                  </div>
                  <div style={{ marginTop: "10px" }}>
                    <label style={{ fontSize: "11px", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>API 키</label>
                    <input
                      type="password"
                      placeholder={`${p.envKey}=...`}
                      disabled={useClaudeCode}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--color-border-strong)", fontSize: "12px", fontFamily: "monospace", outline: "none", boxSizing: "border-box", background: "var(--color-bg)" }}
                    />
                    <div style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginTop: "3px" }}>
                      .env.local 또는 Vercel 환경 변수에 설정하는 것을 권장합니다
                    </div>
                  </div>
                </Card>
              ))}
            </div>

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
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text)", marginBottom: "12px" }}>이번 달 사용량</div>
              <UsageBar label="Claude" used={42800} total={tokenLimit} color="#D97706" />
              <UsageBar label="GPT-4o" used={12400} total={tokenLimit} color="#10A37F" style={{ marginTop: "8px" }} />
              <UsageBar label="Gemini" used={5200}  total={tokenLimit} color="#4285F4" style={{ marginTop: "8px" }} />
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
