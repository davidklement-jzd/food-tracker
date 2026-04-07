-- Tolerantní hledání bez ohledu na diakritiku.
-- Použijeme unaccent + pg_trgm na unaccent verzi názvu.

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

-- Přepiš search funkci tak, aby porovnávala bez diakritiky
create or replace function public.search_foods(q text, lim int default 15)
returns setof public.foods
language sql
stable
as $$
  with normalized as (
    select public.immutable_unaccent(lower(q)) as nq
  )
  select f.*
  from public.foods f, normalized n
  where public.immutable_unaccent(lower(f.title)) % n.nq
     or public.immutable_unaccent(lower(f.title)) ilike '%' || n.nq || '%'
  order by
    (case when public.immutable_unaccent(lower(f.title)) ilike '%' || n.nq || '%' then 0 else 1 end),
    similarity(public.immutable_unaccent(lower(f.title)), n.nq) desc,
    f.confidence asc,
    length(f.title) asc
  limit lim;
$$;

grant execute on function public.search_foods(text, int) to authenticated;
grant execute on function public.immutable_unaccent(text) to authenticated;
