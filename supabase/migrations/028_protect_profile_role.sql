-- BEZPEČNOST (kritická): zabránit eskalaci oprávnění přes UPDATE profilu.
--
-- Politika "Users update own profile" (002_rls_policies.sql) povoluje klientce
-- UPDATE vlastního řádku bez omezení sloupců. Bez této pojistky si klientka
-- mohla přes supabase-js nastavit `role = 'trainer'` (nebo `status`) a získat
-- čtení/zápis dat všech klientek i mazání účtů. Trigger níže povolí změnu
-- `role`/`status` VÝHRADNĚ trenérovi; klientce nechá projít vše ostatní
-- (její cíle, display_name apod.).
--
-- Legitimní zápisy zůstávají funkční:
--   - klientka mění vlastní cíle / jméno   -> role i status beze změny, projde
--   - trenér archivuje klientku (status)   -> is_trainer() = true, projde
--   - trenér nastavuje klientce cíle        -> is_trainer() = true, projde

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.role is distinct from old.role)
     or (new.status is distinct from old.status) then
    if not public.is_trainer() then
      raise exception 'Změna role nebo statusu profilu není povolena';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;

create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_columns();
