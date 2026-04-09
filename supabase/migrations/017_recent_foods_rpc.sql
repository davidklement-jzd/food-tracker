-- Recent foods RPC — vrací klientčiny nedávno použité potraviny pro rychlý
-- one-click insert ve FoodSearchModal. Agreguje podle (lower(name), food_id, unit).
-- Hodnoty maker v `diary_entries` jsou absolutní (za celou gramáž), RPC je
-- přepočítává zpět na /100 g (resp. /100 ml), aby se vešly do existujícího
-- product-shape, který používá fulltextový search (supabaseFoodToProduct).
--
-- Per-meal filter: když p_meal_id není null, vrací jen záznamy z dané sekce jídla.
-- Gramáže jsou "naposledy použité v dané sekci" — banán k snídani (120 g) vs.
-- banán ke svačině (60 g) se udrží odděleně.
--
-- Trainer režim: když p_target_user_id není null, funkce vrací nedávné potraviny
-- zadané klientky. Tento režim vyžaduje, aby volající byl trenér
-- (public.is_trainer() = true), jinak funkce selže. Proto musí být SECURITY DEFINER
-- — běžně by volající (trenér) měl díky RLS přístup jen ke čtení diary_days, ale
-- join + agregace přes cizí data je čistší napsat přes definer a ručně autorizovat.

-- Drop existující verze (return type / signature se mezi iteracemi mění).
drop function if exists public.get_recent_foods(text, int, int);
drop function if exists public.get_recent_foods(text, int, int, uuid);

create or replace function public.get_recent_foods(
  p_meal_id text default null,
  p_days int default 30,
  p_limit int default 20,
  p_target_user_id uuid default null
)
returns table (
  name text,
  brand text,
  unit text,
  food_id text,
  kcal real,
  protein real,
  carbs real,
  fat real,
  fiber real,
  last_grams int,
  last_display_amount text,
  last_used timestamptz,
  usage_count bigint,
  portions jsonb,
  is_liquid boolean,
  default_grams numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- Autorizace: vlastní data jsou vždy OK. Cizí data smí jen trenér.
  if p_target_user_id is null then
    v_user_id := auth.uid();
  else
    if not public.is_trainer() then
      raise exception 'not authorized: only trainers can fetch other users recent foods';
    end if;
    v_user_id := p_target_user_id;
  end if;

  return query
  with scoped as (
    select e.*
    from public.diary_entries e
    join public.diary_days d on d.id = e.day_id
    where d.user_id = v_user_id
      and e.created_at > now() - (p_days || ' days')::interval
      and (p_meal_id is null or e.meal_id = p_meal_id)
      and e.grams > 0
  ),
  latest as (
    select distinct on (lower(s.name), coalesce(s.food_id, ''), s.unit)
      s.name, s.brand, s.unit, s.food_id,
      s.kcal, s.protein, s.carbs, s.fat, s.fiber,
      s.grams as last_grams,
      s.display_amount as last_display_amount,
      s.created_at as last_used
    from scoped s
    order by lower(s.name), coalesce(s.food_id, ''), s.unit, s.created_at desc
  ),
  counts as (
    select lower(s.name) as name_k,
           coalesce(s.food_id, '') as fid_k,
           s.unit as unit_k,
           count(*) as usage_count
    from scoped s
    group by 1, 2, 3
  )
  select
    l.name,
    l.brand,
    l.unit,
    l.food_id,
    (l.kcal    * 100.0 / l.last_grams)::real as kcal,
    (l.protein * 100.0 / l.last_grams)::real as protein,
    (l.carbs   * 100.0 / l.last_grams)::real as carbs,
    (l.fat     * 100.0 / l.last_grams)::real as fat,
    (l.fiber   * 100.0 / l.last_grams)::real as fiber,
    l.last_grams,
    l.last_display_amount,
    l.last_used,
    c.usage_count,
    -- Primární join přes food_id; pokud chybí nebo nemá portions,
    -- fallback přes lower(title) → nejčastější match pro historické záznamy.
    coalesce(f.portions, f_by_name.fbn_portions) as portions,
    coalesce(f.is_liquid, f_by_name.fbn_is_liquid, l.unit = 'ml') as is_liquid,
    coalesce(f.default_grams, f_by_name.fbn_default_grams) as default_grams
  from latest l
  left join counts c
    on c.name_k = lower(l.name)
    and c.fid_k = coalesce(l.food_id, '')
    and c.unit_k = l.unit
  left join public.foods f on f.id = l.food_id
  left join lateral (
    select
      f2.portions as fbn_portions,
      f2.is_liquid as fbn_is_liquid,
      f2.default_grams as fbn_default_grams
    from public.foods f2
    where lower(f2.title) = lower(l.name)
    order by
      case when f2.portions is not null and jsonb_array_length(f2.portions) > 0 then 0 else 1 end,
      f2.confidence nulls last,
      f2.created_at desc
    limit 1
  ) f_by_name on true
  order by l.last_used desc
  limit p_limit;
end;
$$;

grant execute on function public.get_recent_foods(text, int, int, uuid) to authenticated;
