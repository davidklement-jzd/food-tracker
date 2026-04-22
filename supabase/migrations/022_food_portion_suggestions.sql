-- Návrhy úprav porcí od klientek ke schválenym potravinám.
-- Flow: klientka upraví porce u existující (approved) potraviny → vznikne
-- pending návrh; trenér v Databázi surovin schválí/zamítne.
-- Do té doby má klientka navržené porce jen ve svém aktuálním zápise (lokálně).

create table if not exists public.food_portion_suggestions (
  id uuid primary key default gen_random_uuid(),
  food_id text not null references public.foods(id) on delete cascade,
  suggested_by uuid not null references public.profiles(id) on delete cascade,
  suggested_portions jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);

-- Jeden klient = max jeden pending návrh na danou potravinu.
-- Nový návrh přepíše předchozí pending (delete+insert flow v kódu).
create unique index if not exists food_portion_suggestions_one_pending_per_user
  on public.food_portion_suggestions (food_id, suggested_by)
  where status = 'pending';

create index if not exists food_portion_suggestions_status_idx
  on public.food_portion_suggestions (status, created_at desc);

alter table public.food_portion_suggestions enable row level security;

-- SELECT: vlastní návrhy + trenér vidí všechno
drop policy if exists "fps_select" on public.food_portion_suggestions;
create policy "fps_select"
  on public.food_portion_suggestions for select
  to authenticated
  using (suggested_by = auth.uid() or public.is_trainer());

-- INSERT: klient jen vlastní pending
drop policy if exists "fps_insert_own" on public.food_portion_suggestions;
create policy "fps_insert_own"
  on public.food_portion_suggestions for insert
  to authenticated
  with check (suggested_by = auth.uid() and status = 'pending');

-- UPDATE: klient jen svůj pending (přepsání), trenér cokoliv (schvalování)
drop policy if exists "fps_update_own_pending" on public.food_portion_suggestions;
create policy "fps_update_own_pending"
  on public.food_portion_suggestions for update
  to authenticated
  using (suggested_by = auth.uid() and status = 'pending')
  with check (suggested_by = auth.uid() and status = 'pending');

drop policy if exists "fps_update_trainer" on public.food_portion_suggestions;
create policy "fps_update_trainer"
  on public.food_portion_suggestions for update
  to authenticated
  using (public.is_trainer())
  with check (public.is_trainer());

-- DELETE: klient svůj pending, trenér cokoliv
drop policy if exists "fps_delete_own_pending" on public.food_portion_suggestions;
create policy "fps_delete_own_pending"
  on public.food_portion_suggestions for delete
  to authenticated
  using (suggested_by = auth.uid() and status = 'pending');

drop policy if exists "fps_delete_trainer" on public.food_portion_suggestions;
create policy "fps_delete_trainer"
  on public.food_portion_suggestions for delete
  to authenticated
  using (public.is_trainer());
