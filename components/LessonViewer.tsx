"use client";

import { useState } from "react";
import { LessonPackage } from "@/lib/agents/types";

interface LessonViewerProps {
  lesson: LessonPackage;
  onReset: () => void;
}

type Tab = "passage" | "reading" | "vocabulary" | "grammar" | "writing" | "assessment";

const TABS: { key: Tab; label: string }[] = [
  { key: "passage",    label: "지문" },
  { key: "reading",    label: "독해" },
  { key: "vocabulary", label: "어휘" },
  { key: "grammar",    label: "문법" },
  { key: "writing",    label: "쓰기" },
  { key: "assessment", label: "평가" },
];

export function LessonViewer({ lesson, onReset }: LessonViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("passage");

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(lesson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lesson.title.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{lesson.title}</h2>
          <p className="text-sm text-gray-500">
            {lesson.difficulty} · {lesson.wordCount} words
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDownload}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            JSON 저장
          </button>
          <button
            onClick={onReset}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            새 레슨
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="text-sm text-gray-700 space-y-4">
        {activeTab === "passage" && (
          <div className="whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-4">
            {lesson.passage}
          </div>
        )}

        {activeTab === "reading" && (
          <div className="space-y-4">
            {lesson.reading.questions.map((q, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="font-medium">
                  {i + 1}. <span className="text-xs text-gray-400 font-normal">[{q.type}]</span>{" "}
                  {q.question}
                </p>
                <ul className="space-y-1 pl-2">
                  {q.options.map((opt, j) => (
                    <li
                      key={j}
                      className={opt.startsWith(q.answer) ? "text-green-600 font-medium" : ""}
                    >
                      {opt}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400 italic">{q.explanation}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === "vocabulary" && (
          <div className="grid gap-2">
            {lesson.vocabulary.words.map((w, i) => (
              <div key={i} className="border rounded-lg p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-blue-700">{w.word}</span>
                  <span className="text-xs text-gray-400">{w.partOfSpeech}</span>
                  <span className="text-xs text-gray-500 ml-auto">{w.koreanTranslation}</span>
                </div>
                <p className="text-gray-600 mt-0.5">{w.definition}</p>
                <p className="text-xs text-gray-400 italic mt-1">{w.exampleSentence}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === "grammar" && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="font-semibold text-blue-800">{lesson.grammar.focusPoint}</p>
              <p className="mt-1 text-gray-700">{lesson.grammar.explanation}</p>
            </div>
            <div>
              <p className="font-medium mb-2">예문</p>
              <ul className="space-y-1 pl-4">
                {lesson.grammar.examples.map((ex, i) => (
                  <li key={i} className="list-disc text-gray-600">{ex}</li>
                ))}
              </ul>
            </div>
            {lesson.grammar.practiceExercises.map((ex, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="font-medium">연습 {i + 1}: {ex.instruction}</p>
                <ol className="space-y-1 pl-4">
                  {ex.items.map((item, j) => (
                    <li key={j} className="list-decimal text-gray-600">
                      {item}
                      <span className="text-green-600 ml-2">→ {ex.answers[j]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {activeTab === "writing" && (
          <div className="space-y-4">
            <div className="bg-yellow-50 rounded-lg p-3">
              <p className="font-medium text-yellow-800">과제</p>
              <p className="mt-1">{lesson.writing.prompt}</p>
            </div>
            <div>
              <p className="font-medium mb-2">도움말</p>
              <ul className="space-y-1 pl-4">
                {lesson.writing.scaffolding.map((s, i) => (
                  <li key={i} className="list-disc text-gray-600">{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium mb-2">루브릭</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1 text-left">기준</th>
                    <th className="border px-2 py-1 text-center">점수</th>
                    <th className="border px-2 py-1 text-left">설명</th>
                  </tr>
                </thead>
                <tbody>
                  {lesson.writing.rubric.map((r, i) => (
                    <tr key={i}>
                      <td className="border px-2 py-1 font-medium">{r.criterion}</td>
                      <td className="border px-2 py-1 text-center">{r.maxPoints}</td>
                      <td className="border px-2 py-1 text-gray-600">{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="font-medium text-green-800 mb-1">모범 답안</p>
              <p className="text-gray-700 whitespace-pre-wrap">{lesson.writing.modelAnswer}</p>
            </div>
          </div>
        )}

        {activeTab === "assessment" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              총 {lesson.assessment.totalPoints}점 · 합격 기준 {lesson.assessment.passingScore}점
            </p>
            {lesson.assessment.questions.map((q, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-1">
                <p className="font-medium">
                  {i + 1}. <span className="text-xs text-gray-400 font-normal">[{q.type} · {q.points}pt]</span>{" "}
                  {q.question}
                </p>
                {q.options && (
                  <ul className="pl-2 space-y-0.5">
                    {q.options.map((opt, j) => (
                      <li
                        key={j}
                        className={opt.startsWith(q.answer) ? "text-green-600 font-medium" : "text-gray-600"}
                      >
                        {opt}
                      </li>
                    ))}
                  </ul>
                )}
                {!q.options && (
                  <p className="text-green-600 text-xs">정답: {q.answer}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
