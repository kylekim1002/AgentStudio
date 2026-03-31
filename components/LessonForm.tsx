"use client";

import { useState } from "react";
import { AIProvider, DifficultyLevel } from "@/lib/agents/types";

interface LessonFormProps {
  onSubmit: (params: {
    userInput: string;
    provider: AIProvider;
    difficulty?: DifficultyLevel;
    providedPassage?: string;
  }) => void;
  onReset: () => void;
  isRunning: boolean;
}

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: "beginner", label: "Beginner (A1)" },
  { value: "elementary", label: "Elementary (A2)" },
  { value: "intermediate", label: "Intermediate (B1)" },
  { value: "upper-intermediate", label: "Upper-Intermediate (B2)" },
  { value: "advanced", label: "Advanced (C1/C2)" },
];

export function LessonForm({ onSubmit, onReset, isRunning }: LessonFormProps) {
  const [userInput, setUserInput] = useState("");
  const [provider, setProvider] = useState<AIProvider>(AIProvider.CLAUDE);
  const [difficulty, setDifficulty] = useState<DifficultyLevel | "">("");
  const [providedPassage, setProvidedPassage] = useState("");
  const [showPassage, setShowPassage] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim()) return;
    onSubmit({
      userInput: userInput.trim(),
      provider,
      difficulty: difficulty || undefined,
      providedPassage: showPassage && providedPassage.trim() ? providedPassage.trim() : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          레슨 요청 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="예: Make a lesson about the water cycle for grade 5 students"
          rows={3}
          disabled={isRunning}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">AI 제공자</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as AIProvider)}
            disabled={isRunning}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          >
            <option value={AIProvider.CLAUDE}>Claude (Anthropic)</option>
            <option value={AIProvider.GPT}>GPT-4o (OpenAI)</option>
            <option value={AIProvider.GEMINI}>Gemini 1.5 Pro (Google)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            난이도 <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as DifficultyLevel | "")}
            disabled={isRunning}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          >
            <option value="">자동 감지</option>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowPassage(!showPassage)}
          disabled={isRunning}
          className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
        >
          {showPassage ? "▼ 지문 직접 입력 숨기기" : "▶ 지문 직접 입력하기 (선택)"}
        </button>
        {showPassage && (
          <textarea
            value={providedPassage}
            onChange={(e) => setProvidedPassage(e.target.value)}
            placeholder="기존 지문을 붙여넣으면 해당 지문으로 레슨을 생성합니다"
            rows={5}
            disabled={isRunning}
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isRunning || !userInput.trim()}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? "생성 중..." : "레슨 생성"}
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
        )}
      </div>
    </form>
  );
}
