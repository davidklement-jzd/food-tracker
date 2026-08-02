-- Uložená jídla jako jedna sbalitelná položka.
--
-- Když se do jídelníčku vloží uložené jídlo (meal_template), jeho suroviny se
-- zapíšou jako samostatné řádky diary_entries, ale sdílí stejné group_id a nesou
-- group_name (název jídla). UI je pak vykreslí jako jednu sbalitelnou položku,
-- trenér i AI poznají, že jde o uložené jídlo. Řádky bez group_id se chovají
-- jako dřív (běžná samostatná potravina).
--
-- group_name je záměrně denormalizované (uložené natvrdo na řádku), aby jídlo
-- zůstalo pojmenované i po smazání/změně původní šablony.

alter table public.diary_entries
  add column if not exists group_id   uuid,
  add column if not exists group_name text;

-- Rychlé seskupení řádků jednoho jídla v rámci dne.
create index if not exists idx_diary_entries_group
  on public.diary_entries (group_id);
