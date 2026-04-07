-- 1) Sloupec is_liquid: označí nápoje a tekuté produkty
-- 2) Pro nápoje: typické porce (sklenice / plechovka / půllitr / litr)
-- 3) Porce pro NEnápojové položky generuje AI script `generate-portions-ai.mjs` (Haiku batch).

alter table public.foods add column if not exists is_liquid boolean not null default false;

-- Detekce nápojů podle klíčových slov v názvu
update public.foods set is_liquid = true
where is_liquid = false
  and (
    lower(public.immutable_unaccent(title)) ~ '\m(voda|pivo|vino|kola|cola|pepsi|fanta|sprite|juice|dzus|stava|mleko|kefir|smoothie|latte|cappuccino|espresso|caj|limonada|lemonade|napoj|sirup|kakao|presso|frappe|moccacino|mochaccino|kombucha|cider|whisky|rum|gin|vodka|likér|liker|bourbon|tequila|prosecco|sekt|sampanske|sampanske|burcak|absinth|brandy|koňak|konak|aperol|spritz|mojito|piňa|pina|colada|pina colada|mineralka|mineralni voda|tonic|toník|tonik|isotonický|isotonicky|nealko|nealkoholický|nealkoholicky)\M'
    or lower(public.immutable_unaccent(title)) like '%nápoj%'
    or lower(public.immutable_unaccent(title)) like '%drink%'
    or lower(public.immutable_unaccent(title)) like '%beverage%'
    or lower(public.immutable_unaccent(title)) like '%energy%'
  );

-- Pro nápoje: pokud nemají portions, nastav typické nápojové porce
update public.foods
set portions = jsonb_build_array(
  jsonb_build_object('label', 'Sklenice (250 ml)', 'grams', 250),
  jsonb_build_object('label', 'Plechovka (330 ml)', 'grams', 330),
  jsonb_build_object('label', 'Půllitr (500 ml)', 'grams', 500),
  jsonb_build_object('label', 'Litr (1000 ml)', 'grams', 1000)
)
where is_liquid = true
  and (portions is null or jsonb_array_length(portions) = 0);

-- Pro nápoje bez default_grams: nastav 250 ml (sklenice)
update public.foods set default_grams = 250
where is_liquid = true and default_grams is null;
