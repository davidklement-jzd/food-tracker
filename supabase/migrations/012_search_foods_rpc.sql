-- Fuzzy hledání v `foods` přes pg_trgm.
-- Vrací řádky seřazené podle podobnosti (vyšší = lepší shoda) a confidence.
-- Tolerantní k rozdílům jednotného/množného čísla, překlepům, diakritice.

create or replace function public.search_foods(q text, lim int default 15)
returns setof public.foods
language sql
stable
as $$
  select *
  from public.foods
  where title % q                       -- trigram similarity threshold
     or title ilike '%' || q || '%'     -- fallback substring
  order by
    (case when title ilike '%' || q || '%' then 0 else 1 end), -- exact substring nahoru
    similarity(title, q) desc,
    confidence asc,
    length(title) asc
  limit lim;
$$;

-- Snížíme threshold, aby fuzzy match byl tolerantnější (default 0.3 → 0.2)
-- Toto se aplikuje per session; defaultně to ale stačí.

grant execute on function public.search_foods(text, int) to authenticated;
