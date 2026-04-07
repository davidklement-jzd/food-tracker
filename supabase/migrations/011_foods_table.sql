-- Globální databáze potravin (seedovaná z kalorickétabulky.cz, pak nezávislá)

create extension if not exists pg_trgm;

create table if not exists public.foods (
  id text primary key,                  -- KT id (string)
  title text not null,
  slug text,
  kcal numeric,
  protein numeric,
  carbs numeric,
  fat numeric,
  fiber numeric,
  sugar numeric,
  salt numeric,
  saturated_fat numeric,
  category text,
  brand text,
  ean text,
  default_grams numeric,        -- typická porce v gramech (např. 1 banán = 120)
  portions jsonb,               -- alternativní porce: [{"label":"Malá porce","grams":100},...]
  source text not null default 'usda',  -- 'usda' | 'off' | 'manual' | 'user'
  confidence smallint not null default 2, -- 1=ručně ověřeno, 2=USDA/oficiální, 3=OFF, 4=AI guess
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Trigram index pro rychlé fulltextové hledání podle názvu
create index if not exists foods_title_trgm_idx
  on public.foods using gin (title gin_trgm_ops);

create index if not exists foods_title_lower_idx
  on public.foods (lower(title));

-- RLS: čtení pro všechny přihlášené, zápis jen service role
alter table public.foods enable row level security;

drop policy if exists "foods_read_authenticated" on public.foods;
create policy "foods_read_authenticated"
  on public.foods for select
  to authenticated
  using (true);
