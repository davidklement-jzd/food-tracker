#!/bin/bash
# Stáhne Open Food Facts Parquet dump (~7.3 GB) a vyfiltruje jen české produkty
# s validními nutričními hodnotami. Výstup je JSONL kompatibilní s
# import-foods-to-supabase.mjs.
#
# Vyžaduje:
#   - duckdb CLI (brew install duckdb)
#   - cca 8 GB volného místa na disku (parquet + výstup)
#
# Použití:
#   bash scripts/import-off-cz.sh
#
# Pak nahraj výstup do Supabase:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
#   node scripts/import-foods-to-supabase.mjs data/off-cz.jsonl

set -e

PARQUET_URL="https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true"
PARQUET_FILE="data/off-food.parquet"
OUT_FILE="data/off-cz.jsonl"

mkdir -p data

if ! command -v duckdb >/dev/null; then
  echo "❌ DuckDB CLI nenalezen."
  echo "   Nainstaluj: brew install duckdb"
  exit 1
fi

if [ ! -f "$PARQUET_FILE" ]; then
  echo "📥 Stahuju OFF parquet (~7.3 GB) – může trvat 5–30 min podle připojení..."
  curl -L --progress-bar -o "$PARQUET_FILE" "$PARQUET_URL"
else
  echo "✓ Parquet už existuje: $PARQUET_FILE ($(du -h "$PARQUET_FILE" | cut -f1))"
fi

# Smaž starý výstup pokud existuje
rm -f "$OUT_FILE"

echo ""
echo "🔍 Filtruju české produkty přes DuckDB (čte parquet streamem, ~2–5 min)..."

# Pozn: nutriments i product_name jsou seznamy structů. Používáme list_filter
# s lambdou + indexaci [1] (DuckDB indexuje od 1) + přístup k poli přes ['name'].
duckdb <<SQL
COPY (
  WITH base AS (
    SELECT
      'off-' || code AS id,
      COALESCE(
        list_filter(product_name, x -> x.lang = 'cs')[1].text,
        list_filter(product_name, x -> x.lang = 'main')[1].text,
        list_filter(product_name, x -> x.lang = 'en')[1].text,
        product_name[1].text
      ) AS title,
      brands AS brand,
      code AS ean,
      try_cast(serving_quantity AS DOUBLE) AS serving_quantity_g,
      serving_size AS serving_size_text,
      list_filter(nutriments, x -> x.name = 'energy-kcal')[1]['100g'] AS kcal,
      list_filter(nutriments, x -> x.name = 'proteins')[1]['100g'] AS protein,
      list_filter(nutriments, x -> x.name = 'carbohydrates')[1]['100g'] AS carbs,
      list_filter(nutriments, x -> x.name = 'fat')[1]['100g'] AS fat,
      list_filter(nutriments, x -> x.name = 'fiber')[1]['100g'] AS fiber,
      list_filter(nutriments, x -> x.name = 'sugars')[1]['100g'] AS sugar,
      list_filter(nutriments, x -> x.name = 'salt')[1]['100g'] AS salt,
      list_filter(nutriments, x -> x.name = 'saturated-fat')[1]['100g'] AS saturated_fat
    FROM read_parquet('$PARQUET_FILE')
    WHERE list_contains(countries_tags, 'en:czech-republic')
  ),
  filtered AS (
    SELECT
      id,
      title,
      NULL::VARCHAR AS slug,
      kcal,
      protein,
      carbs,
      fat,
      fiber,
      sugar,
      salt,
      saturated_fat,
      NULL::VARCHAR AS category,
      brand,
      ean,
      -- Default porce: nejdřív zkusíme číselné serving_quantity, pak vyparsujeme číslo z textu
      COALESCE(
        CASE WHEN serving_quantity_g BETWEEN 1 AND 1500 THEN serving_quantity_g END,
        try_cast(regexp_extract(serving_size_text, '([0-9]+(?:[\\.,][0-9]+)?)\\s*g', 1) AS DOUBLE)
      ) AS default_grams,
      NULL::JSON AS portions,
      'off' AS source,
      3 AS confidence,
      NULL::JSON AS raw
    FROM base
    WHERE title IS NOT NULL
      AND length(title) > 1
      AND kcal IS NOT NULL
      AND kcal BETWEEN 1 AND 1500
      AND protein IS NOT NULL
      AND protein BETWEEN 0 AND 100
      AND carbs BETWEEN 0 AND 100
      AND fat BETWEEN 0 AND 100
      -- Sanity check: deklarované kcal musí ± 30 % odpovídat (4P + 4C + 9F)
      AND abs(kcal - (4 * protein + 4 * COALESCE(carbs,0) + 9 * COALESCE(fat,0))) < kcal * 0.35
  )
  SELECT * FROM filtered
) TO '$OUT_FILE' (FORMAT JSON, ARRAY false);
SQL

LINES=$(wc -l < "$OUT_FILE" | tr -d ' ')
echo ""
echo "✅ Hotovo. Vyfiltrováno $LINES českých produktů → $OUT_FILE"
echo ""
echo "Další krok – nahraj do Supabase:"
echo "  SUPABASE_URL=https://uxffnpajkhcvtwzsmrcl.supabase.co \\"
echo "  SUPABASE_SERVICE_ROLE_KEY=eyJ... \\"
echo "  node scripts/import-foods-to-supabase.mjs $OUT_FILE"
