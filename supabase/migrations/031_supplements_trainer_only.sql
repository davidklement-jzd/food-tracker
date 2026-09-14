-- „Kalorický dluh" (meal_id = 'supplements') smí zapisovat a mazat jen trenér.
--
-- Sekce je účetní úprava, kterou klientce vyplňuje trenér. Klientka ji má jen
-- vidět — nesmí do ní sama přidávat položky, měnit gramáž ani je mazat. Doteď
-- měla klientka na diary_entries jednu politiku `for all` přes vlastnictví dne;
-- rozdělujeme ji na SELECT (beze změny) a INSERT/UPDATE/DELETE, které
-- 'supplements' vylučují. WITH CHECK u UPDATE navíc brání přesunu řádku do
-- 'supplements' změnou meal_id.
--
-- Trenérské politiky z migrace 008 (is_trainer()) zůstávají — trenér smí
-- všechno, včetně vlastního deníku i deníku klientek. UI (MealSection) tlačítka
-- klientce jen schová; skutečnou zábranou je tahle migrace.

drop policy if exists "Client manages own entries" on public.diary_entries;

create policy "Client reads own entries"
  on public.diary_entries for select
  using (exists (select 1 from public.diary_days
                 where id = diary_entries.day_id and user_id = auth.uid()));

create policy "Client inserts own entries except supplements"
  on public.diary_entries for insert
  with check (
    meal_id <> 'supplements'
    and exists (select 1 from public.diary_days
                where id = diary_entries.day_id and user_id = auth.uid())
  );

create policy "Client updates own entries except supplements"
  on public.diary_entries for update
  using (
    meal_id <> 'supplements'
    and exists (select 1 from public.diary_days
                where id = diary_entries.day_id and user_id = auth.uid())
  )
  with check (
    meal_id <> 'supplements'
    and exists (select 1 from public.diary_days
                where id = diary_entries.day_id and user_id = auth.uid())
  );

create policy "Client deletes own entries except supplements"
  on public.diary_entries for delete
  using (
    meal_id <> 'supplements'
    and exists (select 1 from public.diary_days
                where id = diary_entries.day_id and user_id = auth.uid())
  );
