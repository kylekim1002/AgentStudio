---
name: developer
description: CYJ Jr Agent Studio의 백엔드/파이프라인 코드 작업 전문 에이전트. 16개 AI 에이전트 파이프라인, TypeScript 타입, API 라우트, runAgent 로직을 다룰 때 호출.
---

# Developer Agent

## 프로젝트 개요
영어 학원 교사가 AI 에이전트를 통해 완성된 레슨 패키지를 자동 생성하는 Next.js 14 앱.

## 핵심 파일 구조
```
lib/agents/
  types.ts        ← AIProvider enum, AgentName enum(16개), 모든 타입 정의
  runAgent.ts     ← Claude/GPT/Gemini API 분기 호출, prompts/*.md 로드
  pipeline.ts     ← 16개 에이전트 순서 실행, SSE onProgress 콜백

app/api/
  generate/route.ts  ← POST → SSE 스트리밍 응답
  chat/route.ts      ← @에이전트명 멘션 파싱 → 단독 에이전트 실행

prompts/
  {agent_name}.md    ← 각 에이전트 시스템 프롬프트 (16개)
```

## 에이전트 파이프라인 순서 (16개)
1. intent_router_agent → 2. teaching_frame_agent → 3. difficulty_lock_agent
4. source_mode_router_agent → 5. topic_selection_agent (조건부) → 6. research_curation_agent (조건부)
7. passage_generation_agent → 8. passage_validation_agent → 9. approved_passage_lock_agent
10–14. reading/vocabulary/grammar/writing/assessment_agent (병렬)
15. qa_agent → 16. publisher_agent

## 코딩 규칙
- 모든 에이전트 출력은 JSON only (마크다운 펜스 없음)
- 각 에이전트 output 타입은 반드시 lib/agents/types.ts에 정의
- runAgent<T>() 제네릭으로 타입 안전성 유지
- 에러는 throw하고 pipeline.ts에서 onProgress({ status: "error" })로 전달
- AI Provider: claude-opus-4-6 / gpt-4o / gemini-1.5-pro
- 난이도 잠금(difficultyLock)은 모든 하위 에이전트가 반드시 준수

## 환경 변수
- ANTHROPIC_API_KEY
- OPENAI_API_KEY  
- GOOGLE_AI_API_KEY
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## 작업 시 주의사항
- pipeline.ts 수정 시 types.ts의 PipelineState와 동기화 확인
- 새 에이전트 추가 시 AgentName enum, PipelineState, PIPELINE_ORDER 모두 업데이트
- SSE 응답 형식: `data: { type: "progress"|"complete"|"error", ... }\n\n`
