-- ================================================================
-- Role 컬럼 추가 및 관리자 계정 설정
-- Supabase 대시보드 > SQL Editor에서 실행
-- ================================================================

-- 1. profiles에 role 컬럼 추가
alter table public.profiles
  add column if not exists role text not null default 'teacher'
  check (role in ('admin', 'teacher'));

-- 2. 신규 유저 가입 시 role도 함께 저장 (초대 시 metadata로 전달)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'teacher')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- 3. 본인 role 읽기 허용 (기존 RLS에 추가)
-- (이미 "profiles: select own" 정책이 있으므로 role도 자동으로 읽힘)

-- ================================================================
-- 관리자 계정 직접 설정
-- cyjkyle@gmail.com 을 관리자로 지정
-- (Supabase Auth에서 먼저 초대로 가입 완료 후 실행)
-- ================================================================

-- 아래 이메일을 본인 이메일로 변경 후 실행
update public.profiles
set role = 'admin'
where email = 'cyjkyle@gmail.com';
