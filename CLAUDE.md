# CYJ Junior Agent Studio

## 프로젝트 개요
영어 학원 교사가 AI 에이전트를 통해 완성된 레슨 패키지를 자동 생성하는 시스템.

## 기술 스택
- Next.js 14 (App Router, TypeScript, Tailwind)
- Anthropic Claude API / OpenAI API / Google Gemini API
- Supabase (DB + Auth + Storage)
- Vercel (배포)

## 에이전트 구조 (16개)
파이프라인 순서:
1. intent_router_agent - 요청 분류
2. teaching_frame_agent - 교수 프레임 설정
3. difficulty_lock_agent - 난이도 잠금
4. source_mode_router_agent - 소스 경로 결정
5. topic_selection_agent - 주제 선정 (조건부)
6. research_curation_agent - 리서치 (조건부)
7. passage_generation_agent - 지문 생성
8. passage_validation_agent - 지문 검증
9. approved_passage_lock_agent - 지문 잠금
10. reading_agent - 독해 문제
11. vocabulary_agent - 어휘 학습
12. grammar_agent - 문법 미니레슨
13. writing_agent - 쓰기 과제
14. assessment_agent - 평가지
15. qa_agent - QA 검수
16. publisher_agent - 최종 발행

## 핵심 규칙
- 모든 에이전트는 JSON만 출력
- 각 에이전트 출력이 다음 에이전트 입력으로 체이닝
- AI 제공자: Claude / GPT / Gemini 중 선택 가능
- 난이도 잠금은 모든 하위 에이전트가 반드시 준수

## 다음 작업 순서
1. lib/agents/types.ts 생성
2. lib/agents/runAgent.ts 생성  
3. lib/agents/pipeline.ts 생성
4. app/api/generate/route.ts 생성
5. UI 연결
6. Supabase 연결
7. Vercel 배포
