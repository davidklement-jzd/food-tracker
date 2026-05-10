-- Rozšíření goal_history o všechna makra (B, S, T, V).
-- Doposud měla tabulka jen goal_kcal — z toho plynul bug: změna cílů v profilu
-- propsala novou hodnotu i do předchozích dnů u DailySummary kruhů (B/S/T/V),
-- protože consumer čte z profilu, ne z history.
--
-- Sloupce jsou nullable, ať se nerozbijí existující řádky (jen kcal).
-- Aplikační vrstva (SettingsPage) bude od teď zapisovat všech 5 hodnot najednou.

ALTER TABLE goal_history
  ADD COLUMN IF NOT EXISTS goal_protein int,
  ADD COLUMN IF NOT EXISTS goal_carbs int,
  ADD COLUMN IF NOT EXISTS goal_fat int,
  ADD COLUMN IF NOT EXISTS goal_fiber int;
