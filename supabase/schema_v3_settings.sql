-- ================================================================
-- CYJ Jr Agent Studio — Schema v3
-- profiles 테이블에 settings 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 실행
-- ================================================================

alter table public.profiles
  add column if not exists settings jsonb not null default '{}';
