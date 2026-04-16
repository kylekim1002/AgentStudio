"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AgentName, AgentStatus } from "@/lib/agents/types";
import { AGENT_META, PIPELINE_ORDER, AGENT_GROUPS } from "@/lib/agentMeta";

interface AgentPanelProps {
  agentStates: Map<AgentName, AgentStatus>;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  agent: AgentName | null;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  pending: "대기",
  running: "실행 중",
  done: "완료",
  skipped: "건너뜀",
  error: "오류",
};

const DOT_COLOR: Record<AgentStatus, string> = {
  pending:  "#CBD5E1",
  running:  "#3B82F6",
  done:     "#10B981",
  skipped:  "#E2E8F0",
  error:    "#EF4444",
};

export default function AgentPanel({ agentStates }: AgentPanelProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, agent: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doneCount = Array.from(agentStates.values()).filter((s) => s === "done").length;

  const handleMouseEnter = useCallback((e: React.MouseEvent, agent: AgentName) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      positionTooltip(e.clientX, e.clientY, agent);
    }, 280);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent, agent: AgentName) => {
    if (tooltip.visible && tooltip.agent === agent) {
      positionTooltip(e.clientX, e.clientY, agent);
    }
  }, [tooltip]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltip((t) => ({ ...t, visible: false }));
  }, []);

  function positionTooltip(cx: number, cy: number, agent: AgentName) {
    const TW = 244;
    const TH = 150;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = cx + 14;
    let y = cy - 8;
    if (x + TW > vw) x = cx - TW - 6;
    if (y + TH > vh) y = vh - TH - 8;
    setTooltip({ visible: true, x, y, agent });
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Group agents
  const grouped = AGENT_GROUPS.map((group) => ({
    group,
    agents: PIPELINE_ORDER.filter((a) => AGENT_META[a].group === group),
  }));

  const meta = tooltip.agent ? AGENT_META[tooltip.agent] : null;

  return (
    <>
      <aside style={{
        width: "220px", flexShrink: 0,
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "11px 14px 9px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-subtle)", letterSpacing: ".5px", textTransform: "uppercase" }}>
            에이전트
          </span>
          <span style={{ fontSize: "10px", color: "var(--color-text-subtle)" }}>
            {doneCount}/16 완료
          </span>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {grouped.map(({ group, agents }) => (
            <div key={group}>
              <div style={{
                fontSize: "10px", fontWeight: "600", color: "var(--color-text-subtle)",
                padding: "8px 8px 3px", letterSpacing: ".3px", textTransform: "uppercase",
              }}>
                {group}
                {group === "콘텐츠 생성" && (
                  <span style={{ marginLeft: "5px", fontWeight: "400", color: "#A5B4FC", fontSize: "9px" }}>병렬</span>
                )}
              </div>
              {agents.map((agentName) => {
                const status = agentStates.get(agentName) ?? "pending";
                const m = AGENT_META[agentName];
                return (
                  <div
                    key={agentName}
                    onMouseEnter={(e) => handleMouseEnter(e, agentName)}
                    onMouseMove={(e) => handleMouseMove(e, agentName)}
                    onMouseLeave={handleMouseLeave}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "6px 8px", borderRadius: "6px", cursor: "pointer",
                      marginBottom: "1px",
                      background: "transparent",
                      transition: "background .1s",
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg)"; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                  >
                    {/* Status dot */}
                    <div style={{
                      width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                      background: DOT_COLOR[status],
                      boxShadow: status === "running" ? `0 0 0 3px rgba(59,130,246,.2)` : undefined,
                      animation: status === "running" ? "pulse-dot 1.2s infinite" : undefined,
                    }} />

                    {/* Name */}
                    <span style={{
                      fontSize: "12px", color: "var(--color-text)", flex: 1,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      fontWeight: status === "running" ? "600" : "400",
                    }}>
                      {m.label}
                      <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginLeft: "3px" }}>
                        #{m.num}
                      </span>
                    </span>

                    {/* Status label */}
                    <span style={{
                      fontSize: "10px",
                      color: status === "done" ? "var(--color-success)"
                           : status === "running" ? "var(--color-info)"
                           : status === "error" ? "var(--color-error)"
                           : "var(--color-text-subtle)",
                      flexShrink: 0,
                    }}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Tooltip portal */}
      {tooltip.visible && meta && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 500,
            pointerEvents: "none",
            width: "232px",
          }}
        >
          <div style={{
            background: "#1E293B",
            borderRadius: "9px",
            padding: "11px 14px",
            boxShadow: "0 6px 24px rgba(0,0,0,.28)",
          }}>
            <div style={{ fontSize: "9px", fontWeight: "700", color: "#64748B", letterSpacing: ".6px", textTransform: "uppercase", marginBottom: "4px" }}>
              AGENT {meta.num}
            </div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#F1F5F9", marginBottom: "5px", lineHeight: "1.3" }}>
              {meta.label}
            </div>
            <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: "1.6" }}>
              {meta.desc}
            </div>
            <span style={{
              display: "inline-block", marginTop: "8px",
              padding: "2px 8px", borderRadius: "4px",
              fontSize: "10px", fontWeight: "600",
              background: "rgba(79,70,229,.25)", color: "#A5B4FC",
            }}>
              {meta.tag}
            </span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </>
  );
}
