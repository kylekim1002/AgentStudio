"use client";

import { useState } from "react";
import Link from "next/link";

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

interface AdminClientProps {
  users: UserProfile[];
  adminEmail: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "관리자",
  teacher: "교사",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  teacher: "bg-blue-100 text-blue-700",
};

export function AdminClient({ users: initialUsers, adminEmail }: AdminClientProps) {
  const [users, setUsers] = useState<UserProfile[]>(initialUsers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"teacher" | "admin">("teacher");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage({ type: "success", text: `${inviteEmail} 으로 초대 이메일을 보냈습니다.` });
      setInviteEmail("");
      // 목록 새로고침
      const listRes = await fetch("/api/admin/invite");
      const listData = await listRes.json();
      if (listData.users) setUsers(listData.users);
    } else {
      setMessage({ type: "error", text: data.error ?? "초대 실패" });
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">관리자 대시보드</h1>
          <p className="text-sm text-gray-500">{adminEmail}</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          레슨 생성으로
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* 초대 폼 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">교사 초대</h2>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="초대할 이메일 주소"
                required
                disabled={loading}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "teacher" | "admin")}
                disabled={loading}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="teacher">교사</option>
                <option value="admin">관리자</option>
              </select>
              <button
                type="submit"
                disabled={loading || !inviteEmail}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {loading ? "전송 중..." : "초대 보내기"}
              </button>
            </div>

            {message && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  message.type === "success"
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                {message.text}
              </div>
            )}
          </form>
        </div>

        {/* 사용자 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            사용자 목록 ({users.length})
          </h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{u.email}</p>
                  {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                  <p className="text-xs text-gray-400">
                    {new Date(u.created_at).toLocaleDateString("ko-KR")}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {ROLE_LABELS[u.role] ?? u.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
