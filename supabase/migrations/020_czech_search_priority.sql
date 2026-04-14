-- Vylepšené řazení: české potraviny výš, USDA anglické dole.
-- Signály:
--   1) prefix match
--   2) český název (obsahuje diakritiku = čeština/lokální zdroj)
--   3) source priority: manual/user > off+brand > off > usda
--   4) exact / substring match
--   5) trigram similarity
--   6) penalizace USDA comma-style titulů ("Chicken breast, raw, boneless")
--   7) confidence, kratší titul

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
    -- 1) prefix match
    (public.immutable_unaccent(lower(f.title)) like n.nq || '%') desc,

    -- 2) český název (obsahuje háčky/čárky = lokální potravina)
    (f.title ~ '[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]') desc,

    -- 3) source priority: manual/user nahoře, USDA dole
    case
      when f.source in ('manual', 'user') then 0
      when f.source = 'off' and f.brand is not null and f.brand <> '' then 1
      when f.source = 'off' then 2
      when f.source = 'usda' then 3
      else 4
    end asc,

    -- 4) exact title match
    (public.immutable_unaccent(lower(f.title)) = n.nq) desc,

    -- 5) substring match
    (public.immutable_unaccent(lower(f.title)) ilike '%' || n.nq || '%') desc,

    -- 6) trigram similarity
    similarity(public.immutable_unaccent(lower(f.title)), n.nq) desc,

    -- 7) penalizace čárkových USDA titulů
    (length(f.title) - length(replace(f.title, ',', ''))) asc,

    -- 8) confidence + délka
    f.confidence asc,
    length(f.title) asc
  limit lim;
$$;

grant execute on function public.search_foods(text, int) to authenticated;
