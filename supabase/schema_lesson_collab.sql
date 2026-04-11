alter table public.lessons
  add column if not exists status text not null default 'draft',
  add column if not exists reviewer_id uuid references public.profiles(id) on delete set null,
  add column if not exists review_notes text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz;

alter table public.lessons
  drop constraint if exists lessons_status_check;

alter table public.lessons
  add constraint lessons_status_check
  check (status in ('draft', 'in_review', 'needs_revision', 'approved', 'published'));

create table if not exists public.lesson_comments (
  id uuid default gen_random_uuid() primary key,
  lesson_id uuid references public.lessons(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now() not null
);

create table if not exists public.lesson_activities (
  id uuid default gen_random_uuid() primary key,
  lesson_id uuid references public.lessons(id) on delete cascade not null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  metadata jsonb,
  created_at timestamptz default now() not null
);

create index if not exists lesson_comments_lesson_id_idx on public.lesson_comments(lesson_id);
create index if not exists lesson_activities_lesson_id_idx on public.lesson_activities(lesson_id);
create index if not exists lessons_status_idx on public.lessons(status);
