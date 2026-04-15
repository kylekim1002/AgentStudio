create table if not exists public.ai_usage_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null,
  model text,
  workflow text,
  agent text,
  endpoint text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  metadata jsonb,
  created_at timestamptz default now() not null
);

create index if not exists ai_usage_logs_created_at_idx
  on public.ai_usage_logs(created_at desc);

create index if not exists ai_usage_logs_user_id_idx
  on public.ai_usage_logs(user_id);

alter table public.ai_usage_logs enable row level security;

create policy "ai_usage_logs: select own"
  on public.ai_usage_logs
  for select
  using (auth.uid() = user_id);

create policy "ai_usage_logs: insert own"
  on public.ai_usage_logs
  for insert
  with check (auth.uid() = user_id);
