#!/usr/bin/env node
// Pro každou položku z data/cz-classics.tsv:
//   1) najde nejlepší slug v data/kt-slugs.json (fuzzy match)
//   2) fetchne /potraviny/{slug}, parsuje makra
//   3) zapíše do data/manual-cz.jsonl (formát kompatibilní s fastfood-cz.jsonl)
//   4) vygeneruje tmp/manual-cz-insert.sql
//
// Rate limit: 1 req / 1.5 s. Pro 430 položek ~11 minut.
// Bezpečné: respektuje robots.txt (povoluje /potraviny/*).

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const TSV = 'data/cz-classics.tsv';
const SLUGS_FILE = 'data/kt-slugs.json';
const OUT_JSONL = 'data/manual-cz.jsonl';
const OUT_SQL = 'tmp/manual-cz-insert.sql';
const STATE_FILE = 'data/manual-cz.state.json';
const DELAY_MS = 1500;
const UA = 'food-tracker-research/1.0 (kontakt: david)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\w\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function tokenize(s) { return norm(s).split(/[\s-]+/).filter(Boolean); }

// Skóre slugu vůči query: víc shodných tokenů = lepší; preferuj kratší slug.
function scoreSlug(querySlug, slug) {
  const qt = new Set(tokenize(querySlug));
  const st = tokenize(slug);
  let hits = 0;
  for (const t of st) if (qt.has(t)) hits++;
  if (hits === 0) return -1;
  // bonus pokud první token query je první token slugu
  const firstBonus = (qt.has(st[0]) && [...qt][0] === st[0]) ? 2 : 0;
  // penalizace za extra tokeny ve slugu (specifické brandy/varianty)
  const extras = st.length - hits;
  return hits * 10 + firstBonus - extras;
}

function findBestSlug(title, slugs) {
  const qt = tokenize(title);
  if (!qt.length) return null;
  const exactSlug = qt.join('-');

  // 1) přesná shoda
  for (const { slug } of slugs) if (slug === exactSlug) return slug;

  // 2) slug obsahuje VŠECHNY tokeny (jako prefix nebo část s pomlčkami)
  const allTokensRe = new RegExp('^' + qt.map(t => `(?=.*\\b${t}\\b)`).join('') + '.*$');
  // pomocníky: slug as token sequence
  const candidates = [];
  for (const { slug } of slugs) {
    const st = slug.split('-');
    const stSet = new Set(st);
    let allPresent = true;
    for (const t of qt) if (!stSet.has(t)) { allPresent = false; break; }
    if (!allPresent) continue;
    candidates.push({ slug, st });
  }
  if (candidates.length === 0) {
    // 3) fallback: alespoň 80 % tokenů se shoduje
    for (const { slug } of slugs) {
      const stSet = new Set(slug.split('-'));
      let hits = 0;
      for (const t of qt) if (stSet.has(t)) hits++;
      if (hits / qt.length >= 0.8) candidates.push({ slug, st: slug.split('-') });
    }
  }
  if (candidates.length === 0) return null;

  // vyber: nejmenší počet extra tokenů, pak nejkratší slug
  candidates.sort((a, b) => {
    const ea = a.st.length - qt.length;
    const eb = b.st.length - qt.length;
    if (ea !== eb) return ea - eb;
    return a.slug.length - b.slug.length;
  });
  return candidates[0].slug;
}

// Parsuje makra. Dvě cesty:
//   A) JSON-LD "keywords" array (funguje pro brand-pages)  ← primární
//   B) <span ng-if="data==null">VALUE</span>  v pevném pořadí ← fallback
function parseMacros(html) {
  // A) JSON-LD keywords
  const kwMatch = html.match(/"keywords":\s*\[([^\]]+)\]/);
  if (kwMatch) {
    const items = [...kwMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    const get = (re) => {
      for (const it of items) {
        const m = it.match(re);
        if (m) return parseFloat(m[1].replace(',', '.'));
      }
      return null;
    };
    // "Energetická hodnota : 172 kJ" — pozor: jednotka je špatná, číslo je kcal
    const kcal = get(/Energetická hodnota\s*:\s*([0-9.,]+)/i);
    const protein = get(/Bílkoviny\s*:\s*([0-9.,]+)/i);
    const carbs = get(/Sacharidy\s*:\s*([0-9.,]+)/i);
    const fat = get(/Tuky\s*:\s*([0-9.,]+)/i);
    const sugar = get(/Cukry\s*:\s*([0-9.,]+)/i);
    const saturated_fat = get(/Nasycené mastné kyseliny\s*:\s*([0-9.,]+)/i);
    const salt = get(/Sůl\s*:\s*([0-9.,]+)/i);
    const fiber = get(/Vláknina\s*:\s*([0-9.,]+)/i);
    if (kcal != null && protein != null && carbs != null && fat != null) {
      return { kcal, protein, carbs, fat, sugar, saturated_fat, salt, fiber };
    }
  }

  // B) span fallback
  const re = /<span ng-if="data==null">([0-9.,]+)<\/span>/g;
  const vals = [];
  let m;
  while ((m = re.exec(html)) !== null) vals.push(parseFloat(m[1].replace(',', '.')));
  if (vals.length < 8) return null;
  return {
    kcal: vals[0],
    protein: vals[2],
    carbs: vals[3],
    sugar: vals[4],
    fat: vals[5],
    saturated_fat: vals[6],
    salt: vals[7],
    fiber: null,
  };
}

// Vytáhne hezký název z <title>
function parseTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  if (!m) return null;
  return m[1].replace(/\s*-\s*kalorie.*$/i, '').replace(/\s*\|\s*KalorickéTabulky\.cz\s*$/i, '').trim();
}

async function fetchPage(slug) {
  const url = `https://www.kaloricketabulky.cz/potraviny/${slug}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return await res.text();
}

// === main ===
const slugsRaw = JSON.parse(await readFile(SLUGS_FILE, 'utf8'));
console.log(`loaded ${slugsRaw.length} slugs`);

const tsv = await readFile(TSV, 'utf8');
const items = tsv.split('\n')
  .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('title\t'))
  .map(l => {
    const [title, category] = l.split('\t');
    return { title: title?.trim(), category: category?.trim() };
  })
  .filter(i => i.title);
console.log(`items to fetch: ${items.length}`);

// stav (resume). --retry-misses smaže null záznamy a zkusí je znovu.
let state = { processed: {} };
try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch {}
if (process.argv.includes('--retry-misses')) {
  let cleared = 0;
  for (const k of Object.keys(state.processed)) {
    if (state.processed[k] === null) { delete state.processed[k]; cleared++; }
  }
  console.log(`cleared ${cleared} null entries`);
}

const results = [];
const missing = [];
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  if (state.processed[item.title]) {
    results.push(state.processed[item.title]);
    continue;
  }

  const slug = findBestSlug(item.title, slugsRaw);
  if (!slug) {
    console.log(`  ${i + 1}/${items.length} ❌ no slug: ${item.title}`);
    missing.push(item.title);
    state.processed[item.title] = null;
    continue;
  }

  const html = await fetchPage(slug);
  if (!html) {
    console.log(`  ${i + 1}/${items.length} ❌ fetch failed: ${item.title} (${slug})`);
    missing.push(item.title);
    state.processed[item.title] = null;
    await sleep(DELAY_MS);
    continue;
  }

  const macros = parseMacros(html);
  if (!macros) {
    console.log(`  ${i + 1}/${items.length} ❌ no macros: ${item.title}`);
    missing.push(item.title);
    state.processed[item.title] = null;
    await sleep(DELAY_MS);
    continue;
  }

  const niceTitle = parseTitle(html) || item.title;
  const id = `kt-${slug}`;
  const record = {
    id,
    title: item.title, // zachováme náš čistý český název
    title_kt: niceTitle,
    kcal: macros.kcal,
    protein: macros.protein,
    carbs: macros.carbs,
    sugar: macros.sugar,
    fat: macros.fat,
    saturated_fat: macros.saturated_fat,
    salt: macros.salt,
    category: item.category,
    source: 'manual',
    confidence: 1,
    kt_slug: slug,
  };
  results.push(record);
  state.processed[item.title] = record;
  console.log(`  ${i + 1}/${items.length} ✅ ${item.title} → ${macros.kcal}kcal`);

  // průběžné ukládání každých 20
  if (i % 20 === 0) await writeFile(STATE_FILE, JSON.stringify(state));

  await sleep(DELAY_MS);
}

await writeFile(STATE_FILE, JSON.stringify(state));

// JSONL
const jsonlLines = results.filter(Boolean).map(r => JSON.stringify(r));
await writeFile(OUT_JSONL, jsonlLines.join('\n') + '\n');
console.log(`\nwrote ${OUT_JSONL}: ${jsonlLines.length} rows`);
console.log(`missing: ${missing.length}`);
if (missing.length) {
  console.log('chybí:');
  for (const m of missing) console.log(`  - ${m}`);
}

// SQL INSERT
await mkdir('tmp', { recursive: true });
const sql = ['-- Manual CZ classics (Fáze 5)', `-- ${jsonlLines.length} položek`, 'begin;'];
for (const r of results.filter(Boolean)) {
  const cols = ['id', 'title', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt', 'saturated_fat', 'category', 'source', 'confidence'];
  const vals = [
    `'${r.id.replace(/'/g, "''")}'`,
    `'${r.title.replace(/'/g, "''")}'`,
    r.kcal,
    r.protein,
    r.carbs,
    r.fat,
    r.fiber ?? 'null',
    r.sugar ?? 'null',
    r.salt ?? 'null',
    r.saturated_fat ?? 'null',
    `'${(r.category || '').replace(/'/g, "''")}'`,
    `'manual'`,
    1,
  ];
  sql.push(`insert into public.foods (${cols.join(', ')}) values (${vals.join(', ')}) on conflict (id) do update set title=excluded.title, kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat, sugar=excluded.sugar, salt=excluded.salt, saturated_fat=excluded.saturated_fat, category=excluded.category, source=excluded.source, confidence=excluded.confidence;`);
}
sql.push('commit;');
await writeFile(OUT_SQL, sql.join('\n') + '\n');
console.log(`wrote ${OUT_SQL}`);
