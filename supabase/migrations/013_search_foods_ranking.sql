-- Vylepšený ranking pro search_foods.
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
