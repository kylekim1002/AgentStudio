create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;

drop policy if exists "system_settings: select authenticated" on public.system_settings;
create policy "system_settings: select authenticated"
on public.system_settings
for select
to authenticated
using (true);

drop policy if exists "system_settings: manage admin lead" on public.system_settings;
create policy "system_settings: manage admin lead"
on public.system_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'lead_teacher')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'lead_teacher')
  )
);

insert into public.system_settings (key, value)
values (
  'review_note_templates',
  '{
    "approved": [
      "전체 흐름이 자연스럽고 바로 사용 가능합니다.",
      "난이도와 문항 구성이 적절해 승인합니다."
    ],
    "needs_revision": [
      "문항 표현을 조금 더 명확하게 다듬은 뒤 다시 요청해 주세요.",
      "어휘 설명과 문법 포인트 연결을 조금 더 보강해 주세요."
    ]
  }'::jsonb
)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values (
  'review_sla_hours',
  '24'::jsonb
)
on conflict (key) do nothing;
