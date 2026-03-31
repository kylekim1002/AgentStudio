"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
        shouldCreateUser: false,
      },
    });

    if (error) {
      if (
        error.message.includes("Signups not allowed") ||
        error.message.includes("not found") ||
        error.message.includes("Invalid")
      ) {
        setError("등록되지 않은 이메일입니다. 관리자에게 초대를 요청하세요.");
      } else {
        setError(error.message);
      }
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "12px",
          padding: "40px",
          width: "100%",
          maxWidth: "360px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "28px",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "9px",
              background: "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: "16px",
              fontWeight: "700",
            }}
          >
            C
          </div>
          <div>
            <div
              style={{
                fontWeight: "700",
                fontSize: "16px",
                color: "var(--color-text)",
                lineHeight: 1.2,
              }}
            >
              CYJ Jr{" "}
              <span style={{ color: "var(--color-primary)" }}>Studio</span>
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                marginTop: "1px",
              }}
            >
              AI 영어 레슨 자동 생성 시스템
            </div>
          </div>
        </div>

        {sent ? (
          <div
            style={{
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: "600",
                color: "#065F46",
                marginBottom: "6px",
              }}
            >
              이메일을 확인하세요
            </div>
            <div style={{ fontSize: "13px", color: "#047857" }}>
              <strong>{email}</strong>으로 로그인 링크를 보냈습니다.
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#059669",
                marginTop: "8px",
              }}
            >
              링크는 1시간 동안 유효합니다.
            </div>
          </div>
        ) : (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: "500",
                  color: "var(--color-text)",
                  marginBottom: "6px",
                }}
              >
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="등록된 이메일 주소"
                required
                disabled={loading}
                style={{
                  width: "100%",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "7px",
                  padding: "9px 12px",
                  fontSize: "14px",
                  color: "var(--color-text)",
                  background: loading ? "var(--color-bg)" : "var(--color-surface)",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--color-primary)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--color-border-strong)";
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: "7px",
                  padding: "10px 12px",
                  fontSize: "13px",
                  color: "#DC2626",
                  marginBottom: "16px",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              style={{
                width: "100%",
                background:
                  loading || !email
                    ? "var(--color-border-strong)"
                    : "var(--color-primary)",
                color:
                  loading || !email ? "var(--color-text-muted)" : "#fff",
                border: "none",
                borderRadius: "7px",
                padding: "10px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: loading || !email ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {loading ? "전송 중..." : "로그인 링크 받기"}
            </button>

            <p
              style={{
                fontSize: "12px",
                textAlign: "center",
                color: "var(--color-text-subtle)",
                marginTop: "16px",
              }}
            >
              관리자로부터 초대를 받아야 사용할 수 있습니다
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
