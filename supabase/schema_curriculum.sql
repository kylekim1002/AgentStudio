create table if not exists public.curriculum_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  semester text not null,
  level_name text not null,
  subject text not null,
  content_type text not null,
  storage_path text not null,
  file_url text not null,
  file_type text not null,
  notes text,
  status text not null default 'uploaded',
  lexile_min integer,
  lexile_max integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_asset_pages (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.curriculum_assets(id) on delete cascade,
  page_number integer not null,
  extracted_text text,
  preview_image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_passages (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.curriculum_assets(id) on delete cascade,
  title text not null,
  body text not null,
  lexile_min integer,
  lexile_max integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_question_sets (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.curriculum_assets(id) on delete cascade,
  passage_id uuid references public.curriculum_passages(id) on delete set null,
  section_type text not null,
  question_style text,
  item_count integer not null default 0,
  style_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_questions (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.curriculum_question_sets(id) on delete cascade,
  question_type text not null,
  prompt text not null,
  choices jsonb,
  answer text,
  explanation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_transform_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.curriculum_assets(id) on delete cascade,
  status text not null default 'queued',
  provider text,
  model text,
  error_message text,
  result_summary jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists curriculum_assets_filter_idx
  on public.curriculum_assets (semester, level_name, subject, content_type, status, created_at desc);
create index if not exists curriculum_asset_pages_asset_idx
  on public.curriculum_asset_pages (asset_id, page_number);
create index if not exists curriculum_passages_asset_idx
  on public.curriculum_passages (asset_id);
create index if not exists curriculum_question_sets_asset_idx
  on public.curriculum_question_sets (asset_id, section_type);
create index if not exists curriculum_questions_set_idx
  on public.curriculum_questions (question_set_id);
create index if not exists curriculum_transform_jobs_asset_idx
  on public.curriculum_transform_jobs (asset_id, created_at desc);

alter table public.curriculum_assets enable row level security;
alter table public.curriculum_asset_pages enable row level security;
alter table public.curriculum_passages enable row level security;
alter table public.curriculum_question_sets enable row level security;
alter table public.curriculum_questions enable row level security;
alter table public.curriculum_transform_jobs enable row level security;

drop policy if exists "curriculum_assets select authenticated" on public.curriculum_assets;
create policy "curriculum_assets select authenticated"
on public.curriculum_assets for select to authenticated using (true);

drop policy if exists "curriculum_assets insert authenticated" on public.curriculum_assets;
create policy "curriculum_assets insert authenticated"
on public.curriculum_assets for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "curriculum_assets update own" on public.curriculum_assets;
create policy "curriculum_assets update own"
on public.curriculum_assets for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "curriculum_assets delete own" on public.curriculum_assets;
create policy "curriculum_assets delete own"
on public.curriculum_assets for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "curriculum_asset_pages select authenticated" on public.curriculum_asset_pages;
create policy "curriculum_asset_pages select authenticated"
on public.curriculum_asset_pages for select to authenticated using (true);

drop policy if exists "curriculum_asset_pages mutate own" on public.curriculum_asset_pages;
create policy "curriculum_asset_pages mutate own"
on public.curriculum_asset_pages for all to authenticated
using (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
);

drop policy if exists "curriculum_passages select authenticated" on public.curriculum_passages;
create policy "curriculum_passages select authenticated"
on public.curriculum_passages for select to authenticated using (true);

drop policy if exists "curriculum_passages mutate own" on public.curriculum_passages;
create policy "curriculum_passages mutate own"
on public.curriculum_passages for all to authenticated
using (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
);

drop policy if exists "curriculum_question_sets select authenticated" on public.curriculum_question_sets;
create policy "curriculum_question_sets select authenticated"
on public.curriculum_question_sets for select to authenticated using (true);

drop policy if exists "curriculum_question_sets mutate own" on public.curriculum_question_sets;
create policy "curriculum_question_sets mutate own"
on public.curriculum_question_sets for all to authenticated
using (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
);

drop policy if exists "curriculum_questions select authenticated" on public.curriculum_questions;
create policy "curriculum_questions select authenticated"
on public.curriculum_questions for select to authenticated using (true);

drop policy if exists "curriculum_questions mutate own" on public.curriculum_questions;
create policy "curriculum_questions mutate own"
on public.curriculum_questions for all to authenticated
using (
  exists (
    select 1
    from public.curriculum_question_sets qs
    join public.curriculum_assets a on a.id = qs.asset_id
    where qs.id = question_set_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.curriculum_question_sets qs
    join public.curriculum_assets a on a.id = qs.asset_id
    where qs.id = question_set_id and a.user_id = auth.uid()
  )
);

drop policy if exists "curriculum_transform_jobs select authenticated" on public.curriculum_transform_jobs;
create policy "curriculum_transform_jobs select authenticated"
on public.curriculum_transform_jobs for select to authenticated using (true);

drop policy if exists "curriculum_transform_jobs mutate own" on public.curriculum_transform_jobs;
create policy "curriculum_transform_jobs mutate own"
on public.curriculum_transform_jobs for all to authenticated
using (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.curriculum_assets a
    where a.id = asset_id and a.user_id = auth.uid()
  )
);

create or replace function public.set_curriculum_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists curriculum_assets_set_updated_at on public.curriculum_assets;
create trigger curriculum_assets_set_updated_at
before update on public.curriculum_assets
for each row
execute function public.set_curriculum_assets_updated_at();
