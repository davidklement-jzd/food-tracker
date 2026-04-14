-- Šablony jídel (recepty) — uživatel si uloží kombinaci potravin
-- a může ji jedním klikem přidat do libovolného jídla.

create table public.meal_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  items       jsonb not null,   -- [{name, food_id, grams, unit, kcal, protein, carbs, fat, fiber, brand, display_amount}]
  total_kcal  real not null default 0,
  created_at  timestamptz default now()
);

create index idx_meal_templates_user on public.meal_templates (user_id);

alter table public.meal_templates enable row level security;

-- Uživatel vidí a spravuje své šablony
create policy "user_select_own_templates"
  on public.meal_templates for select
  using (user_id = auth.uid() or public.is_trainer());

create policy "user_insert_own_templates"
  on public.meal_templates for insert
  with check (user_id = auth.uid());

create policy "user_update_own_templates"
  on public.meal_templates for update
  using (user_id = auth.uid());

create policy "user_delete_own_templates"
  on public.meal_templates for delete
  using (user_id = auth.uid());
