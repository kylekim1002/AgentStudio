"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface Lesson {
  id: string;
  title: string;
  difficulty: string;
  provider: string;
  created_at: string;
  isFavorite: boolean;
}

interface DashboardClientProps {
  user: User;
  lessons: Lesson[];
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  elementary: "bg-blue-100 text-blue-700",
  intermediate: "bg-yellow-100 text-yellow-700",
  "upper-intermediate": "bg-orange-100 text-orange-700",
  advanced: "bg-red-100 text-red-700",
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  gpt: "GPT-4o",
  gemini: "Gemini",
};

export function DashboardClient({ user, lessons: initialLessons }: DashboardClientProps) {
  const [lessons, setLessons] = useState<Lesson[]>(initialLessons);
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const toggleFavorite = async (lesson: Lesson) => {
    const method = lesson.isFavorite ? "DELETE" : "POST";
    await fetch(`/api/lessons/${lesson.id}/favorite`, { method });
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lesson.id ? { ...l, isFavorite: !l.isFavorite } : l
      )
    );
  };

  const deleteLesson = async (id: string) => {
    if (!confirm("이 레슨을 삭제할까요?")) return;
    await fetch(`/api/lessons/${id}`, { method: "DELETE" });
    setLessons((prev) => prev.filter((l) => l.id !== id));
  };

  const filtered = filter === "favorites"
    ? lessons.filter((l) => l.isFavorite)
    : lessons;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CYJ Jr Agent Studio</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            새 레슨 생성
          </button>
          <button
            onClick={handleSignOut}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800">
            레슨 히스토리 ({lessons.length})
          </h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(["all", "favorites"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {f === "all" ? "전체" : "즐겨찾기"}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">아직 저장된 레슨이 없습니다</p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 text-sm text-blue-600 hover:underline"
            >
              첫 레슨 생성하기
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((lesson) => (
              <div
                key={lesson.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{lesson.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        DIFFICULTY_COLORS[lesson.difficulty] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {lesson.difficulty}
                    </span>
                    <span className="text-xs text-gray-400">
                      {PROVIDER_LABELS[lesson.provider] ?? lesson.provider}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(lesson.created_at).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleFavorite(lesson)}
                    className={`text-lg transition-colors ${
                      lesson.isFavorite ? "text-yellow-400" : "text-gray-200 hover:text-yellow-300"
                    }`}
                    title={lesson.isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}
                  >
                    ★
                  </button>
                  <button
                    onClick={() => deleteLesson(lesson.id)}
                    className="text-sm text-gray-400 hover:text-red-500 transition-colors"
                    title="삭제"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
