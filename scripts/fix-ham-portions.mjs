#!/usr/bin/env node
// Opraví porce u šunek (a volitelně i dalších nářezových produktů) v Supabase
// tabulce `foods` na základě reálných dat z Open Food Facts — polí `quantity`
// a `serving_size`, která jsme při původním importu ignorovali.
//
// Pipeline:
//   1. Načte seznam produktů z DB podle --filter (default: šunky)
//   2. Z OFF parquetu (cache přes DuckDB) dostane quantity + serving_size
//   3. Naparsuje gramáž plátku a gramáž balení
//   4. Vygeneruje porce: 1 plátek / 2 plátky / N plátků / Celé balení
//   5. Dry-run vypíše tabulku starých vs. nových porcí; --apply to zapíše do DB
//
// Vyžaduje:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   duckdb CLI (brew install duckdb)
//
// Použití:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fix-ham-portions.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fix-ham-portions.mjs --apply
//
// Flagy:
//   --filter=šunk        substring v title (default: šunk, hledá case-insensitive, unaccent)
//   --apply              opravdu zapsat změny do DB (jinak jen dry-run)
//   --limit=50           omezit počet zpracovaných produktů
//   --refresh-cache      smazat cache a znovu načíst z parquetu

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);

const FILTER = (args.filter || 'šunk').toLowerCase();
const APPLY = !!args.apply;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const REFRESH_CACHE = !!args['refresh-cache'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const PARQUET = resolve('data/off-food.parquet');
const CACHE = resolve('data/off-serving-cache.jsonl');

if (!existsSync(PARQUET)) {
  console.error(`❌ Parquet nenalezen: ${PARQUET}`);
  console.error('   Spusť nejdřív: bash scripts/import-off-cz.sh');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cache OFF serving info (jednou, pak už jen z disku)
// ─────────────────────────────────────────────────────────────────────────────

function buildCache() {
  console.log('📦 Buildím cache z OFF parquetu (cca 1–3 min)…');
  const sql = `
COPY (
  SELECT
    code,
    quantity,
    serving_size
  FROM read_parquet('${PARQUET}')
  WHERE list_contains(countries_tags, 'en:czech-republic')
    AND (quantity IS NOT NULL OR serving_size IS NOT NULL)
) TO '${CACHE}' (FORMAT JSON, ARRAY false);
`;
  execSync(`duckdb -c "${sql.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
  console.log(`✓ Cache: ${CACHE}`);
}

if (REFRESH_CACHE && existsSync(CACHE)) unlinkSync(CACHE);
if (!existsSync(CACHE)) buildCache();

const offByEan = new Map();
for (const line of readFileSync(CACHE, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.code) offByEan.set(String(row.code), row);
}
console.log(`✓ Načteno ${offByEan.size} OFF produktů s quantity/serving_size`);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Parsery
// ─────────────────────────────────────────────────────────────────────────────

function parsePackageGrams(quantity) {
  if (!quantity) return null;
  const s = String(quantity).toLowerCase().replace(/\s+/g, ' ').trim();
  const mKg = s.match(/^([\d.,]+)\s*kg/);
  if (mKg) return Math.round(parseFloat(mKg[1].replace(',', '.')) * 1000);
  const mG = s.match(/^([\d.,]+)\s*g/);
  if (mG) return Math.round(parseFloat(mG[1].replace(',', '.')));
  return null;
}

// Produkty, kterým v názvu stojí "šunka", ale reálně to není plátkovaná šunka.
// Tam by label "1 plátek" zaváděl — necháme původní porce beze změny.
const NON_SLICED_KEYWORDS = [
  'sýr', 'syr', 'tavený', 'taveny',
  'párek', 'parek', 'párky', 'parky', 'párků', 'parku',
  'pomazánka', 'pomazanka',
  'krém', 'krem',
  'bageta', 'sendvič', 'sendvic',
  'polévka', 'polevka',
  'salát', 'salat',
  'paštika', 'pastika',
  'žervé', 'zerve', 'lučina', 'lucina', // značky tavených sýrů
];

function isNonSliced(title) {
  const t = title.toLowerCase();
  return NON_SLICED_KEYWORDS.some((kw) => t.includes(kw));
}

function parseServingInfo({ serving_size, quantity }) {
  const pkg = parsePackageGrams(quantity);
  if (!serving_size) return pkg ? { packageGrams: pkg } : null;

  const s = String(serving_size).trim().toLowerCase();

  // "N portion (Yg)" — N plátků v balení, celkem Y gramů
  const mN = s.match(/^(\d+)\s*portion[s]?\s*\(\s*([\d.,]+)\s*g\s*\)/);
  if (mN) {
    const n = parseInt(mN[1], 10);
    const total = parseFloat(mN[2].replace(',', '.'));
    if (n > 1 && total > 0) {
      return { sliceGrams: total / n, sliceCount: n, packageGrams: pkg || Math.round(total) };
    }
    if (n === 1 && total > 0) {
      if (pkg && Math.abs(total - pkg) < 1) return { packageGrams: pkg };
      if (total >= 5 && total <= 80) return { sliceGrams: total, packageGrams: pkg };
    }
  }

  // "1 pack (Xg)" — celé balení, neuseful
  if (/^\d+\s*pack/.test(s)) return pkg ? { packageGrams: pkg } : null;

  // čisté "Xg" nebo "X.Yg" nebo "X,Yg"
  const mG = s.match(/^([\d.,]+)\s*g$/);
  if (mG) {
    const g = parseFloat(mG[1].replace(',', '.'));
    if (pkg && Math.abs(g - pkg) < 1) return { packageGrams: pkg };
    if (g >= 5 && g <= 80) return { sliceGrams: g, packageGrams: pkg };
  }

  return pkg ? { packageGrams: pkg } : null;
}

function generatePortions(info) {
  if (!info || !info.sliceGrams) return null;

  const sg = info.sliceGrams;

  // Sanity check: pod 7g to nemůže být plátek (spíš namazání, poleva, mýlka v OFF).
  if (sg < 7) return null;

  const round = (x) => Math.round(x);
  const sgDisplay = sg < 10 ? sg.toFixed(1).replace('.0', '') : String(round(sg));

  // ≥ 40 g / kus → nazvat to "Porce", ne "plátek" (nikdo neřeže 50g plátky).
  const asPorce = sg >= 40;
  const singleLabel = asPorce ? `Porce (${sgDisplay} g)` : `1 plátek (${sgDisplay} g)`;
  const doubleLabel = asPorce ? `2 porce (${round(sg * 2)} g)` : `2 plátky (${round(sg * 2)} g)`;
  const nLabel = (n) => asPorce
    ? `${n} porce (${round(sg * n)} g)`
    : `${n} plátky (${round(sg * n)} g)`;

  const out = [
    { label: singleLabel, grams: round(sg) },
    { label: doubleLabel, grams: round(sg * 2) },
  ];

  if (info.packageGrams) {
    const fit = Math.floor(info.packageGrams / sg);
    if (fit >= 4) {
      out.push({ label: nLabel(4), grams: round(sg * 4) });
    } else if (fit === 3) {
      out.push({ label: nLabel(3), grams: round(sg * 3) });
    }
    out.push({ label: `Celé balení (${info.packageGrams} g)`, grams: info.packageGrams });
  }

  const seen = new Set();
  return out.filter((p) => {
    if (p.grams < 1 || seen.has(p.grams)) return false;
    seen.add(p.grams);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fetch z DB, spočítej diff
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFoods() {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = supabase
      .from('foods')
      .select('id, title, brand, ean, default_grams, portions, source')
      .eq('source', 'off')
      .not('ean', 'is', null)
      .ilike('title', `%${FILTER}%`)
      .range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const foods = await fetchFoods();
console.log(`✓ Z DB: ${foods.length} položek odpovídajících "${FILTER}"`);

const results = [];
for (const food of foods) {
  if (isNonSliced(food.title)) {
    results.push({ food, info: null, newPortions: null, reason: 'neplátkovaný produkt (sýr/párek/spread/...)' });
    continue;
  }
  const off = offByEan.get(String(food.ean));
  if (!off) {
    results.push({ food, info: null, newPortions: null, reason: 'EAN není v OFF cache' });
    continue;
  }
  const info = parseServingInfo(off);
  const newPortions = generatePortions(info);
  results.push({ food, off, info, newPortions });
}

const changes = results.filter((r) => r.newPortions);
const toApply = LIMIT ? changes.slice(0, LIMIT) : changes;

console.log('');
console.log(`📊 Výsledek:`);
console.log(`   ${changes.length} / ${foods.length} má reálná data → nové porce`);
console.log(`   ${foods.length - changes.length} nemá použitelná data → nezměníme`);
console.log('');

// Dry-run tabulka (prvních 30 + pár bez změny pro kontext)
console.log('─'.repeat(120));
console.log('ZMĚNY (prvních 30):');
console.log('─'.repeat(120));
for (const r of toApply.slice(0, 30)) {
  const { food, off, info, newPortions } = r;
  const oldP = food.portions ? food.portions.map((p) => `${p.label}=${p.grams}g`).join(', ') : '(žádné)';
  const newP = newPortions.map((p) => `${p.label}=${p.grams}g`).join(', ');
  console.log(`\n[${food.ean}] ${food.title} (${food.brand || '—'})`);
  console.log(`   OFF raw:  quantity="${off.quantity || ''}"  serving_size="${off.serving_size || ''}"`);
  console.log(`   parsed:   sliceGrams=${info?.sliceGrams ?? '—'}  packageGrams=${info?.packageGrams ?? '—'}`);
  console.log(`   OLD:      ${oldP}`);
  console.log(`   NEW:      ${newP}`);
}

if (toApply.length > 30) {
  console.log(`\n... a dalších ${toApply.length - 30} změn.`);
}

console.log('');
console.log('─'.repeat(120));
console.log('BEZ ZMĚNY (prvních 10, pro kontrolu):');
console.log('─'.repeat(120));
for (const r of results.filter((x) => !x.newPortions).slice(0, 10)) {
  const reason = r.reason
    || (r.info?.packageGrams ? 'jen packageGrams, žádná info o plátku' : 'parser nenašel nic');
  console.log(`\n[${r.food.ean}] ${r.food.title} (${r.food.brand || '—'})`);
  if (r.off) {
    console.log(`   OFF raw:  quantity="${r.off.quantity || ''}"  serving_size="${r.off.serving_size || ''}"`);
  }
  console.log(`   důvod:    ${reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Apply
// ─────────────────────────────────────────────────────────────────────────────

if (!APPLY) {
  console.log('');
  console.log('ℹ️  Dry-run. Pro zápis přidej --apply');
  process.exit(0);
}

console.log('');
console.log(`✍️  Zapisuju ${toApply.length} změn do DB…`);
let ok = 0;
let failed = 0;
for (const r of toApply) {
  const { error } = await supabase
    .from('foods')
    .update({ portions: r.newPortions })
    .eq('id', r.food.id);
  if (error) {
    console.error(`  ❌ ${r.food.id} — ${error.message}`);
    failed++;
  } else {
    ok++;
  }
}
console.log(`✓ Hotovo: ${ok} OK, ${failed} chyb`);
