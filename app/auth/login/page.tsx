"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
        shouldCreateUser: false, // 초대된 사용자만 로그인 가능
      },
    });

    if (error) {
      if (error.message.includes("Signups not allowed")) {
        setError("초대된 계정만 로그인할 수 있습니다. 관리자에게 문의하세요.");
      } else if (error.message.includes("not found") || error.message.includes("Invalid")) {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">CYJ Jr Agent Studio</h1>
        <p className="text-sm text-gray-500 mb-6">초대받은 계정으로 로그인</p>

        {sent ? (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
            <p className="font-medium">이메일을 확인하세요</p>
            <p className="mt-1">{email} 으로 로그인 링크를 보냈습니다.</p>
            <p className="mt-2 text-xs text-green-600">링크는 1시간 동안 유효합니다.</p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="등록된 이메일 주소"
                required
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "전송 중..." : "로그인 링크 받기"}
            </button>

            <p className="text-xs text-center text-gray-400">
              관리자로부터 초대를 받아야 사용할 수 있습니다
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
