create table if not exists public.workflow_executions (
  id text primary key,
  workflow text not null,
  status text not null,
  approval_status text not null default 'not_required',
  risk_level text not null default 'safe',
  current_step text,
  checkpoint jsonb,
  input jsonb not null,
  result jsonb,
  error text,
  steps jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists workflow_executions_workflow_idx
  on public.workflow_executions (workflow);

create index if not exists workflow_executions_status_idx
  on public.workflow_executions (status);

create index if not exists workflow_executions_updated_at_idx
  on public.workflow_executions (updated_at desc);

create table if not exists public.approval_requests (
  id text primary key,
  workflow text not null,
  execution_id text not null references public.workflow_executions(id) on delete cascade,
  step text,
  risk_level text not null,
  title text not null,
  summary text not null,
  status text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  reason text
);

create index if not exists approval_requests_execution_id_idx
  on public.approval_requests (execution_id);

create index if not exists approval_requests_status_idx
  on public.approval_requests (status);
