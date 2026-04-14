-- Invite codes for closed registration
-- Only trainer can create codes; clients use them during signup

create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  trainer_id  uuid not null references public.profiles(id) on delete cascade,
  client_name text default '',
  created_at  timestamptz default now(),
  expires_at  timestamptz default (now() + interval '7 days'),
  used_by     uuid references public.profiles(id) on delete set null,
  used_at     timestamptz
);

-- Index for fast lookup during signup
create index idx_invite_codes_code on public.invite_codes (code);

-- RLS
alter table public.invite_codes enable row level security;

-- Trainer can see their own codes
create policy "trainer_select_own_invites"
  on public.invite_codes for select
  using (trainer_id = auth.uid());

-- Trainer can create codes
create policy "trainer_insert_invites"
  on public.invite_codes for insert
  with check (trainer_id = auth.uid());

-- Trainer can delete unused codes
create policy "trainer_delete_unused_invites"
  on public.invite_codes for delete
  using (trainer_id = auth.uid() and used_by is null);
