import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CYJ Jr Agent Studio",
  description: "AI 에이전트 기반 영어 레슨 패키지 자동 생성 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
