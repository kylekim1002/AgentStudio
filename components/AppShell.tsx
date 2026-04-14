"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeInboxSync } from "@/lib/ui/inboxSync";

interface AppShellProps {
  userEmail: string;
  userName: string;
  userRole: string;
  userFeatures: string[];
  children: React.ReactNode;
}

interface InboxSummary {
  myDrafts: number;
  myNeedsRevision: number;
  myInReview: number;
  myApproved: number;
  reviewQueue: number;
  reassignedToMeCount: number;
  reassignedFromMeCount: number;
  inboxTotal: number;
}

interface NotificationSettings {
  notificationsEnabled?: boolean;
  reviewAlerts?: boolean;
  revisionAlerts?: boolean;
  quietStartHour?: number;
  quietEndHour?: number;
}

const BASE_NAV_TABS = [
  {
    href: "/work",
    label: "내 작업함",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 3.5h10v9H3v-9z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5.5 2v3M10.5 2v3M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/studio",
    label: "스튜디오",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/>
        <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor"/>
        <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/>
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/>
      </svg>
    ),
  },
  {
    href: "/library",
    label: "학습자료소",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 3h4v10H2V3zM6 3h4v10H6V3zM10 3h4v10h-4V3z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "시스템 설정",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" fill="currentColor"/>
        <path d="M13.3 8a5.3 5.3 0 00-.06-.8l1.7-1.3-1.6-2.8-2 .8a5.3 5.3 0 00-1.4-.8L9.6 1H6.4l-.3 2.1a5.3 5.3 0 00-1.4.8l-2-.8L1.1 5.9 2.8 7.2a5.3 5.3 0 000 1.6L1.1 10.1l1.6 2.8 2-.8c.4.3.9.6 1.4.8l.3 2.1h3.2l.3-2.1c.5-.2 1-.5 1.4-.8l2 .8 1.6-2.8-1.7-1.3c.04-.26.06-.53.06-.8z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
      </svg>
    ),
  },
];

export default function AppShell({
  userEmail,
  userName,
  userRole,
  userFeatures,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    notificationsEnabled: true,
    reviewAlerts: true,
    revisionAlerts: true,
    quietStartHour: 22,
    quietEndHour: 8,
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const previousSummaryRef = useRef<InboxSummary | null>(null);

  const isQuietHours = useMemo(() => {
    const currentHour = new Date().getHours();
    const start = notificationSettings.quietStartHour ?? 22;
    const end = notificationSettings.quietEndHour ?? 8;

    if (start === end) return false;
    if (start < end) {
      return currentHour >= start && currentHour < end;
    }
    return currentHour >= start || currentHour < end;
  }, [notificationSettings.quietEndHour, notificationSettings.quietStartHour]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotificationSettings() {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled) {
        setNotificationSettings((prev) => ({
          ...prev,
          ...(data.settings ?? {}),
        }));
      }
    }

    loadNotificationSettings();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    function maybeNotify(next: InboxSummary) {
      const previous = previousSummaryRef.current;
      previousSummaryRef.current = next;
      setInboxCount(next.inboxTotal ?? 0);

      if (!previous || !notificationSettings.notificationsEnabled) return;
      if (isQuietHours) return;

      if (
        notificationSettings.reviewAlerts &&
        next.reviewQueue > previous.reviewQueue
      ) {
        setToastMessage(`새 검토 요청 ${next.reviewQueue - previous.reviewQueue}건이 들어왔습니다.`);
        return;
      }

      if (
        notificationSettings.revisionAlerts &&
        next.myNeedsRevision > previous.myNeedsRevision
      ) {
        setToastMessage(`수정 요청된 레슨이 ${next.myNeedsRevision - previous.myNeedsRevision}건 생겼습니다.`);
        return;
      }

      if (next.reassignedToMeCount > previous.reassignedToMeCount) {
        setToastMessage(`새 검토가 ${next.reassignedToMeCount - previous.reassignedToMeCount}건 재배정되었습니다.`);
        return;
      }

      if (next.reassignedFromMeCount > previous.reassignedFromMeCount) {
        setToastMessage(`내 검토 항목 ${next.reassignedFromMeCount - previous.reassignedFromMeCount}건이 다른 검토자로 이동했습니다.`);
      }
    }

    async function pollInbox() {
      const res = await fetch("/api/inbox/summary", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      maybeNotify(data.summary as InboxSummary);
    }

    pollInbox();
    timer = window.setInterval(pollInbox, 45000);

    function handleInboxSync() {
      void pollInbox();
    }

    const unsubscribe = subscribeInboxSync(handleInboxSync);

    return () => {
      cancelled = true;
      unsubscribe();
      if (timer) window.clearInterval(timer);
    };
  }, [
    isQuietHours,
    notificationSettings.notificationsEnabled,
    notificationSettings.reviewAlerts,
    notificationSettings.revisionAlerts,
  ]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  const displayName = userName || userEmail;
  const navTabs = [
    ...BASE_NAV_TABS,
    ...((userRole === "admin" || userRole === "lead_teacher")
      ? [
          {
            href: "/templates",
            label: "템플릿 관리",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ),
          },
        ]
      : []),
    ...(userFeatures.includes("ops.view")
      ? [
          {
            href: "/ops",
            label: "운영 센터",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 12h12M3 10l2.2-3 2 2 3.3-4L13 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="3" cy="10" r="1" fill="currentColor"/>
                <circle cx="7.2" cy="9" r="1" fill="currentColor"/>
                <circle cx="10.5" cy="5" r="1" fill="currentColor"/>
                <circle cx="13" cy="8" r="1" fill="currentColor"/>
              </svg>
            ),
          },
        ]
      : []),
  ];
  const initials = displayName
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* ── Top Navigation ── */}
      <header
        style={{
          height: "var(--nav-height)",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: "0",
          flexShrink: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginRight: "32px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "7px",
              background: "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: "13px",
              fontWeight: "700",
            }}
          >
            C
          </div>
          <span
            style={{
              fontWeight: "700",
              fontSize: "15px",
              color: "var(--color-text)",
              letterSpacing: "-0.3px",
            }}
          >
            CYJ Jr <span style={{ color: "var(--color-primary)" }}>Studio</span>
          </span>
        </div>

        {/* Tabs */}
        <nav style={{ display: "flex", alignItems: "stretch", height: "100%", flex: 1 }}>
          {navTabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "0 16px",
                  fontSize: "14px",
                  fontWeight: isActive ? "600" : "500",
                  color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
                  borderBottom: isActive
                    ? "2px solid var(--color-primary)"
                    : "2px solid transparent",
                  marginBottom: isActive ? "-1px" : "0",
                  textDecoration: "none",
                  transition: "color 0.15s, border-color 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.href === "/work" && inboxCount > 0 && (
                  <span
                    style={{
                      minWidth: "18px",
                      height: "18px",
                      padding: "0 6px",
                      borderRadius: "999px",
                      background: "var(--color-primary-light)",
                      color: "var(--color-primary)",
                      fontSize: "11px",
                      fontWeight: "700",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {inboxCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right: admin badge + user menu */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          {userFeatures.includes("admin.manage_users") && (
            <Link
              href="/admin"
              style={{
                fontSize: "11px",
                fontWeight: "600",
                color: "var(--color-primary)",
                background: "var(--color-primary-light)",
                padding: "3px 8px",
                borderRadius: "4px",
                textDecoration: "none",
              }}
            >
              관리자
            </Link>
          )}

          {/* User Avatar Button */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "700",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initials || "U"}
            </button>

            {userMenuOpen && (
              <>
                {/* Backdrop */}
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 199,
                  }}
                  onClick={() => setUserMenuOpen(false)}
                />
                {/* Dropdown */}
                <div
                  style={{
                    position: "absolute",
                    top: "40px",
                    right: 0,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    minWidth: "200px",
                    zIndex: 200,
                    overflow: "hidden",
                  }}
                >
                  {/* User Info */}
                  <div
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "var(--color-text)",
                      }}
                    >
                      {displayName}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text-muted)",
                        marginTop: "2px",
                      }}
                    >
                      {userEmail}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: userRole === "admin" ? "var(--color-primary)" : "var(--color-text-subtle)",
                        marginTop: "4px",
                        fontWeight: "500",
                      }}
                    >
                      {userRole === "admin"
                        ? "관리자"
                        : userRole === "lead_teacher"
                          ? "수석 강사"
                          : userRole === "reviewer"
                            ? "검토자"
                            : "선생님"}
                    </div>
                  </div>

                  {/* Menu Items */}
                  <button
                    onClick={handleLogout}
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: "13px",
                      color: "var(--color-error)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M5 12H3a1 1 0 01-1-1V3a1 1 0 011-1h2M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Page Content ── */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </main>

      {toastMessage && (
        <div
          style={{
            position: "fixed",
            right: "20px",
            bottom: "20px",
            zIndex: 220,
            minWidth: "280px",
            maxWidth: "360px",
            padding: "14px 16px",
            borderRadius: "12px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "var(--color-primary-light)",
                color: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                flexShrink: 0,
              }}
            >
              🔔
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text)", marginBottom: "4px" }}>
                새 작업 알림
              </div>
              <div style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                {toastMessage}
              </div>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--color-text-subtle)",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
