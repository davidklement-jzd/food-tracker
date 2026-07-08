-- Vylepšený ranking pro search_foods + tolerantní hledání bez diakritiky.
-- (Sloučeno z původních dvou souborů se stejnou verzí 013 —
--  013_search_foods_ranking + 013_unaccent_search. Duplicitní verze 013
--  rozbíjela zápis do historie migrací i `db reset`. Finální definici
--  search_foods stejně přebírá pozdější migrace 020_czech_search_priority
--  — zde je proto ranking verze jen jako mezistav; unaccent/immutable_unaccent/
--  index zůstávají jako závislost, kterou 020 používá.)
--
-- Pořadí signálů:
--   1) prefix match  ("rohlík" → "Rohlík tukový" před "Klobása s rohlíkem")
--   2) source priority: manual > usda > off+brand > off
--   3) exact / substring / trigram similarity
--   4) penalizace USDA "comma-style" titulů
--   5) confidence, kratší titul

create or replace function public.search_foods(q text, lim int default 15)
returns setof public.foods
language sql
stable
as $$
  select f.*
  from public.foods f
  where f.title % q
     or f.title ilike '%' || q || '%'
  order by
    (lower(f.title) like lower(q) || '%') desc,
    case
      when f.source = 'manual' then 0
      when f.source = 'usda' then 1
      when f.source = 'off' and f.brand is not null and f.brand <> '' then 2
      else 3
    end asc,
    (lower(f.title) = lower(q)) desc,
    (lower(f.title) like '%' || lower(q) || '%') desc,
    similarity(f.title, q) desc,
    (length(f.title) - length(replace(f.title, ',', ''))) asc,
    f.confidence asc,
    length(f.title) asc
  limit lim;
$$;

grant execute on function public.search_foods(text, int) to authenticated;

-- ===== Tolerantní hledání bez ohledu na diakritiku =====
-- Použijeme unaccent + pg_trgm na unaccent verzi názvu. Tyto objekty jsou
-- závislostí pro migraci 020 (její search_foods je používá).
create extension if not exists unaccent;

-- pg_trgm potřebuje IMMUTABLE funkci pro index. Wrapper kolem unaccent
-- (Postgres unaccent je jen STABLE).
create or replace function public.immutable_unaccent(text)
  returns text
  language sql
  immutable
  parallel safe
as $$
  select public.unaccent('public.unaccent', $1)
$$;

-- Index na unaccent verzi pro rychlý trigram match
create index if not exists foods_title_unaccent_trgm_idx
  on public.foods using gin (public.immutable_unaccent(title) gin_trgm_ops);

grant execute on function public.immutable_unaccent(text) to authenticated;
