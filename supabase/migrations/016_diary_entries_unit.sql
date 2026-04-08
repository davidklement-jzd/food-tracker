-- Sloupec `unit` v diary_entries: rozlišuje pevné potraviny (g) od tekutin (ml).
-- Hodnota v `grams` zůstává numerický sloupec — pro tekutiny v něm leží ml
-- (konvence 1 ml ≈ 1 g, pro vodu/pivo/mléko/limonády fyzikálně přesné dost).
-- Frontend zobrazuje a edituje s odpovídajícím suffixem podle `unit`.

alter table public.diary_entries
  add column if not exists unit text not null default 'g'
    check (unit in ('g', 'ml'));
