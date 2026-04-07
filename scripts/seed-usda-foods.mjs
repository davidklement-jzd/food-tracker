#!/usr/bin/env node
// Stáhne generické potraviny z USDA FoodData Central (public domain).
// Datasety: SR Legacy (~7800 generických surovin) + Foundation Foods (vysoká kvalita).
//
// Vyžaduje:
//   USDA_API_KEY (zdarma na https://fdc.nal.usda.gov/api-key-signup.html)
//
// Použití:
//   USDA_API_KEY=... node scripts/seed-usda-foods.mjs
//
// Výstup:
//   data/usda-foods.jsonl  — jedna potravina = jeden řádek (anglicky, normalizovaná makra)

import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const API_KEY = process.env.USDA_API_KEY;
if (!API_KEY) {
  console.error('Missing USDA_API_KEY env var. Get free key at https://fdc.nal.usda.gov/api-key-signup.html');
  process.exit(1);
}

const OUT_FILE = 'data/usda-foods.jsonl';
const PAGE_SIZE = 200;
const DELAY_MS = 200;
// Datasety, které nás zajímají: kvalitní generická data
const DATA_TYPES = ['Foundation', 'SR Legacy'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mapování USDA nutrientů → naše pole. /foods/list endpoint vrací nutrienty
// s polem `number` (legacy NDB) a `name`, NE s FDC id. Mapujeme podle obojího.
const NUTRIENT_BY_NUMBER = {
  '208': 'kcal',          // Energy (kcal)
  '203': 'protein',
  '205': 'carbs',         // Carbohydrate, by difference
  '204': 'fat',
  '291': 'fiber',
  '269': 'sugar',
  '307': 'sodium',
  '606': 'saturated_fat',
};
const NUTRIENT_BY_FDC_ID = {
  1008: 'kcal',
  2047: 'kcal',
  2048: 'kcal',
  1003: 'protein',
  1005: 'carbs',
  1004: 'fat',
  1079: 'fiber',
  2000: 'sugar',
  1093: 'sodium',
  1258: 'saturated_fat',
};
function nutrientKey(n) {
  if (n.number != null && NUTRIENT_BY_NUMBER[String(n.number)]) return NUTRIENT_BY_NUMBER[String(n.number)];
  const fdcId = n.nutrient?.id ?? n.nutrientId;
  if (fdcId != null && NUTRIENT_BY_FDC_ID[fdcId]) return NUTRIENT_BY_FDC_ID[fdcId];
  // Fallback podle name (case-insensitive)
  const name = (n.name || n.nutrient?.name || '').toLowerCase();
  if (name.startsWith('energy') && (n.unitName || '').toLowerCase() === 'kcal') return 'kcal';
  if (name === 'protein') return 'protein';
  if (name.startsWith('carbohydrate')) return 'carbs';
  if (name.startsWith('total lipid') || name === 'total fat') return 'fat';
  if (name.startsWith('fiber')) return 'fiber';
  if (name.startsWith('sugars')) return 'sugar';
  if (name === 'sodium, na' || name === 'sodium') return 'sodium';
  if (name.includes('saturated')) return 'saturated_fat';
  return null;
}

function extractNutrients(food) {
  const out = { kcal: null, protein: null, carbs: null, fat: null, fiber: null, sugar: null, saturated_fat: null, salt: null };
  for (const n of food.foodNutrients || []) {
    const val = n.amount ?? n.value;
    if (val == null) continue;
    const key = nutrientKey(n);
    if (!key) continue;
    if (key === 'sodium') {
      out.salt = Math.round((val * 2.5) / 100) / 10; // mg Na → g soli
    } else if (out[key] == null) {
      out[key] = val;
    }
  }
  return out;
}

function normalizeFood(food) {
  const n = extractNutrients(food);
  return {
    id: `usda-${food.fdcId}`,
    title_en: food.description,
    category_en: food.foodCategory?.description || food.foodCategory || null,
    fdcId: food.fdcId,
    dataType: food.dataType,
    ...n,
    source: 'usda',
  };
}

async function fetchPage(dataType, page) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/list?api_key=${API_KEY}&dataType=${encodeURIComponent(dataType)}&pageSize=${PAGE_SIZE}&pageNumber=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${dataType} page ${page}`);
  return res.json();
}

async function main() {
  await mkdir(dirname(OUT_FILE), { recursive: true });
  if (existsSync(OUT_FILE)) {
    console.log(`Removing existing ${OUT_FILE}…`);
    await writeFile(OUT_FILE, '');
  }

  let total = 0;
  for (const dataType of DATA_TYPES) {
    console.log(`\n== ${dataType} ==`);
    let page = 1;
    while (true) {
      const items = await fetchPage(dataType, page);
      if (!Array.isArray(items) || items.length === 0) break;
      const normalized = items.map(normalizeFood).filter((f) => f.kcal != null);
      const lines = normalized.map((f) => JSON.stringify(f)).join('\n') + '\n';
      if (normalized.length > 0) await appendFile(OUT_FILE, lines);
      total += normalized.length;
      console.log(`  ${dataType} p${page}: +${normalized.length} (total ${total})`);
      if (items.length < PAGE_SIZE) break;
      page++;
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. ${total} USDA foods saved to ${OUT_FILE}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
