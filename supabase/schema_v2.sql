-- ================================================================
-- CYJ Jr Agent Studio — Schema v2
-- Supabase 대시보드 > SQL Editor에서 실행
-- ================================================================

-- 1. projects 테이블 먼저 생성 (lessons가 참조하므로 반드시 먼저)
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  code text,
  description text,
  created_at timestamptz default now() not null
);

-- 2. RLS for projects
alter table public.projects enable row level security;

create policy "projects: select own" on public.projects
  for select using (auth.uid() = user_id);

create policy "projects: insert own" on public.projects
  for insert with check (auth.uid() = user_id);

create policy "projects: update own" on public.projects
  for update using (auth.uid() = user_id);

create policy "projects: delete own" on public.projects
  for delete using (auth.uid() = user_id);

-- 3. lessons에 project_id, tags 컬럼 추가 (projects 테이블 생성 후)
alter table public.lessons
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists tags text[] not null default '{}';

-- 4. 인덱스
create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists lessons_project_id_idx on public.lessons(project_id);
