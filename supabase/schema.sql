-- ================================================================
-- CYJ Jr Agent Studio — Supabase Schema
-- Supabase 대시보드 > SQL Editor에서 전체 실행
-- ================================================================

-- 1. profiles (교사 프로필)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  name text,
  academy_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 2. lessons (생성된 레슨 패키지)
create table if not exists public.lessons (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  difficulty text not null,
  provider text not null,
  package jsonb not null,
  created_at timestamptz default now() not null
);

-- 3. favorites (즐겨찾기)
create table if not exists public.favorites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  lesson_id uuid references public.lessons(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(user_id, lesson_id)
);

-- ================================================================
-- Row Level Security
-- ================================================================

alter table public.profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.favorites enable row level security;

-- profiles: 본인 데이터만
create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- lessons: 본인 데이터만
create policy "lessons: select own" on public.lessons
  for select using (auth.uid() = user_id);

create policy "lessons: insert own" on public.lessons
  for insert with check (auth.uid() = user_id);

create policy "lessons: delete own" on public.lessons
  for delete using (auth.uid() = user_id);

-- favorites: 본인 데이터만
create policy "favorites: select own" on public.favorites
  for select using (auth.uid() = user_id);

create policy "favorites: insert own" on public.favorites
  for insert with check (auth.uid() = user_id);

create policy "favorites: delete own" on public.favorites
  for delete using (auth.uid() = user_id);

-- ================================================================
-- 신규 유저 가입 시 profiles 자동 생성
-- ================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ================================================================
-- 인덱스
-- ================================================================

create index if not exists lessons_user_id_idx on public.lessons(user_id);
create index if not exists lessons_created_at_idx on public.lessons(created_at desc);
create index if not exists favorites_user_id_idx on public.favorites(user_id);
create index if not exists favorites_lesson_id_idx on public.favorites(lesson_id);
