-- Sdílená databáze surovin se schvalovacím workflow.
-- Klientky mohou přidávat vlastní potraviny; vznikají jako 'pending'.
-- Ve vyhledávání je autorka vidí hned, ostatní až po schválení trenérem.
-- Trenérská editace pending potraviny se retroaktivně propíše do
-- diary_entries té klientky (přes novou vazbu diary_entries.food_id).

-- 1) Nové sloupce v foods
alter table public.foods
  add column if not exists status text not null default 'approved'
    check (status in ('approved', 'pending', 'rejected')),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

-- Existující záznamy (USDA/OFF/manual import) jsou automaticky 'approved' díky defaultu.
-- Nově vkládané user záznamy musí explicitně nastavit status='pending'.

create index if not exists foods_status_created_by_idx
  on public.foods (status, created_by);

-- 2) Vazba z diary_entries na foods (pro retroaktivní update pending záznamů)
alter table public.diary_entries
  add column if not exists food_id text references public.foods(id) on delete set null;

create index if not exists diary_entries_food_id_idx
  on public.diary_entries (food_id);

-- 3) RLS pro foods — přepis selectu a přidání write policies
drop policy if exists "foods_read_authenticated" on public.foods;

create policy "foods_select"
  on public.foods for select
  to authenticated
  using (
    status = 'approved'
    or created_by = auth.uid()
    or public.is_trainer()
  );

-- Klient může vkládat jen vlastní pending záznamy (status si nemůže povýšit).
create policy "foods_insert_own_pending"
  on public.foods for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
  );

-- Trenér může vkládat cokoliv (service role i tak obchází RLS).
create policy "foods_insert_trainer"
  on public.foods for insert
  to authenticated
  with check (public.is_trainer());

-- Klient může upravovat jen svoje pending záznamy.
create policy "foods_update_own_pending"
  on public.foods for update
  to authenticated
  using (created_by = auth.uid() and status = 'pending')
  with check (created_by = auth.uid() and status = 'pending');

-- Trenér může upravovat cokoliv (včetně schvalování).
create policy "foods_update_trainer"
  on public.foods for update
  to authenticated
  using (public.is_trainer())
  with check (public.is_trainer());

-- Mazání jen trenér (klient si svůj pending záznam opraví editací).
create policy "foods_delete_trainer"
  on public.foods for delete
  to authenticated
  using (public.is_trainer());

-- 4) search_foods RPC — filtruje podle viditelnosti stejně jako RLS.
--    Zachovává unaccent + ranking logiku z migrace 013_unaccent_search.sql.
create or replace function public.search_foods(q text, lim int default 15)
returns setof public.foods
language sql
stable
security invoker
as $$
  with normalized as (
    select public.immutable_unaccent(lower(q)) as nq
  )
  select f.*
  from public.foods f, normalized n
  where (
         public.immutable_unaccent(lower(f.title)) % n.nq
      or public.immutable_unaccent(lower(f.title)) ilike '%' || n.nq || '%'
        )
    and (
         f.status = 'approved'
      or f.created_by = auth.uid()
      or public.is_trainer()
        )
  order by
    (case when public.immutable_unaccent(lower(f.title)) ilike '%' || n.nq || '%' then 0 else 1 end),
    similarity(public.immutable_unaccent(lower(f.title)), n.nq) desc,
    f.confidence asc,
    length(f.title) asc
  limit lim;
$$;

grant execute on function public.search_foods(text, int) to authenticated;
