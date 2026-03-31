"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LessonForm } from "@/components/LessonForm";
import { PipelineProgress } from "@/components/PipelineProgress";
import { LessonViewer } from "@/components/LessonViewer";
import { useLessonGenerate } from "@/hooks/useLessonGenerate";
import { createClient } from "@/lib/supabase/client";

interface HomeClientProps {
  userEmail: string;
  userName: string;
  userRole: string;
}

export function HomeClient({ userEmail, userName, userRole }: HomeClientProps) {
  const router = useRouter();
  const {
    isRunning,
    agentStates,
    pipelineOrder,
    lessonPackage,
    error,
    generate,
    reset,
  } = useLessonGenerate();

  const showProgress =
    isRunning ||
    (lessonPackage === null &&
      error === null &&
      Array.from(agentStates.values()).some((s) => s.status !== "pending"));

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CYJ Jr Agent Studio</h1>
          <p className="text-sm text-gray-500 mt-0.5">AI 에이전트 기반 영어 레슨 패키지 자동 생성</p>
        </div>
        <nav className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{userName}</span>
          <Link
            href="/dashboard"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            레슨 히스토리
          </Link>
          {userRole === "admin" && (
            <Link
              href="/admin"
              className="text-sm text-purple-600 hover:text-purple-800 font-medium transition-colors"
            >
              관리자
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            로그아웃
          </button>
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {lessonPackage ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <LessonViewer lesson={lessonPackage} onReset={reset} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">레슨 요청</h2>
              <LessonForm onSubmit={generate} onReset={reset} isRunning={isRunning} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">파이프라인 진행</h2>
              {error ? (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                  <p className="font-medium">오류 발생</p>
                  <p className="mt-1">{error}</p>
                  <button
                    onClick={reset}
                    className="mt-3 text-xs underline hover:no-underline"
                  >
                    다시 시작
                  </button>
                </div>
              ) : showProgress ? (
                <PipelineProgress
                  pipelineOrder={pipelineOrder}
                  agentStates={agentStates}
                />
              ) : (
                <div className="text-sm text-gray-400 text-center py-12">
                  레슨 요청을 입력하면<br />16개 에이전트가 순서대로 실행됩니다
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
