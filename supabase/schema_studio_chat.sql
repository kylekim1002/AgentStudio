create table if not exists public.studio_chat_threads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default '새 프로젝트',
  provider text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.studio_chat_messages (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references public.studio_chat_threads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  agent_name text,
  created_at timestamptz default now() not null
);

create index if not exists studio_chat_threads_user_id_updated_at_idx
  on public.studio_chat_threads(user_id, updated_at desc);

create index if not exists studio_chat_messages_thread_id_created_at_idx
  on public.studio_chat_messages(thread_id, created_at asc);

alter table public.studio_chat_threads enable row level security;
alter table public.studio_chat_messages enable row level security;

create policy "studio_chat_threads: select own"
  on public.studio_chat_threads
  for select
  using (auth.uid() = user_id);

create policy "studio_chat_threads: insert own"
  on public.studio_chat_threads
  for insert
  with check (auth.uid() = user_id);

create policy "studio_chat_threads: update own"
  on public.studio_chat_threads
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "studio_chat_threads: delete own"
  on public.studio_chat_threads
  for delete
  using (auth.uid() = user_id);

create policy "studio_chat_messages: select own"
  on public.studio_chat_messages
  for select
  using (auth.uid() = user_id);

create policy "studio_chat_messages: insert own"
  on public.studio_chat_messages
  for insert
  with check (auth.uid() = user_id);

create policy "studio_chat_messages: delete own"
  on public.studio_chat_messages
  for delete
  using (auth.uid() = user_id);
