#!/usr/bin/env node
// Deduplikace foods tabulky přímo v Supabase.
// Logika adaptovaná z dedupe-simulate.mjs.
//
// Použití:
//   node scripts/dedupe-supabase.mjs            # dry-run (jen report)
//   node scripts/dedupe-supabase.mjs --apply    # skutečné smazání
//
// Potřebuje env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const PCT = 15;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}
const supabase = createClient(url, key);

// Normalize title for grouping
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,()\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function macrosClose(a, b) {
  for (const f of ['kcal', 'protein', 'carbs', 'fat']) {
    const av = Number(a[f]), bv = Number(b[f]);
    if (!isFinite(av) || !isFinite(bv)) return false;
    const max = Math.max(Math.abs(av), Math.abs(bv));
    if (max < 0.5) continue;
    if ((Math.abs(av - bv) / max) * 100 > PCT) return false;
  }
  return true;
}

function sourceRank(r) {
  if (r.source === 'manual') return 0;
  if (r.source === 'user') return 0;
  if (r.source === 'off' && r.brand) return 1;
  if (r.source === 'off') return 2;
  if (r.source === 'usda') return 3;
  return 4;
}

function completeness(r) {
  let s = 0;
  for (const f of ['fiber', 'brand', 'category', 'ean', 'default_grams', 'portions']) {
    if (r[f] != null && r[f] !== '') s++;
  }
  return s;
}

function pickWinner(items) {
  return items.slice().sort((a, b) => {
    const sr = sourceRank(a) - sourceRank(b);
    if (sr) return sr;
    const cd = completeness(b) - completeness(a);
    if (cd) return cd;
    return (a.id || '').length - (b.id || '').length;
  })[0];
}

// Fetch all foods, paginated
async function fetchAllFoods() {
  const all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('foods')
      .select('id, title, brand, source, ean, kcal, protein, carbs, fat, fiber, category, default_grams, portions, status, created_by')
      .range(from, from + pageSize - 1);
    if (error) { console.error('Fetch error:', error.message); process.exit(1); }
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

console.log(APPLY ? '⚡ APPLY MODE — changes will be written!' : '🔍 DRY RUN — no changes');
console.log('Fetching foods...');
const foods = await fetchAllFoods();
console.log(`Loaded ${foods.length} foods\n`);

// Group by normalized title
const groups = new Map();
for (const f of foods) {
  if (!f.title) continue;
  const k = norm(f.title);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(f);
}

let totalRemoved = 0;
let groupsTouched = 0;
const removedBySource = {};
const allLosers = []; // { loserId, winnerId }

for (const [, items] of groups) {
  if (items.length < 2) continue;

  // Cluster by macro similarity
  const buckets = [];
  for (const it of items) {
    let placed = false;
    for (const b of buckets) {
      if (macrosClose(b[0], it)) { b.push(it); placed = true; break; }
    }
    if (!placed) buckets.push([it]);
  }

  for (const b of buckets) {
    if (b.length < 2) continue;
    const winner = pickWinner(b);

    // Protect: OFF with EAN (barcode-scannable) + pending user foods
    const losers = b.filter(
      (r) =>
        r !== winner &&
        !(r.source === 'off' && r.ean) &&
        !(r.status === 'pending')
    );
    if (losers.length === 0) continue;

    groupsTouched++;
    for (const l of losers) {
      totalRemoved++;
      removedBySource[l.source] = (removedBySource[l.source] || 0) + 1;
      allLosers.push({ loserId: l.id, winnerId: winner.id });
    }
  }
}

console.log('═══ SOUHRN ═══');
console.log(`Skupin k úpravě:    ${groupsTouched}`);
console.log(`Řádků k odstranění: ${totalRemoved}`);
for (const [src, cnt] of Object.entries(removedBySource).sort((a, b) => b[1] - a[1])) {
  console.log(`  - ${src}: ${cnt}`);
}
console.log(`Zůstane v DB:       ${foods.length - totalRemoved}\n`);

if (!APPLY) {
  // Show samples
  let shown = 0;
  for (const { loserId, winnerId } of allLosers.slice(0, 10)) {
    const loser = foods.find((f) => f.id === loserId);
    const winner = foods.find((f) => f.id === winnerId);
    console.log(`✗ DROP [${loser.source}] "${loser.title}" ${loser.kcal}kcal → ✓ KEEP [${winner.source}] "${winner.title}" ${winner.kcal}kcal`);
    shown++;
  }
  if (allLosers.length > 10) console.log(`  ... a ${allLosers.length - 10} dalších`);
  console.log('\nPro skutečné smazání spusť: node scripts/dedupe-supabase.mjs --apply');
  process.exit(0);
}

// APPLY: re-link diary_entries then delete losers
console.log('Re-linking diary_entries...');
let relinked = 0;
for (const { loserId, winnerId } of allLosers) {
  const { count } = await supabase
    .from('diary_entries')
    .update({ food_id: winnerId })
    .eq('food_id', loserId)
    .select('id', { count: 'exact', head: true });
  relinked += count || 0;
}
console.log(`Re-linked ${relinked} diary entries`);

console.log('Deleting duplicate foods...');
const loserIds = allLosers.map((l) => l.loserId);
// Delete in batches of 100
for (let i = 0; i < loserIds.length; i += 100) {
  const batch = loserIds.slice(i, i + 100);
  const { error } = await supabase.from('foods').delete().in('id', batch);
  if (error) console.error(`Batch delete error at ${i}:`, error.message);
}
console.log(`Deleted ${loserIds.length} duplicate foods.`);
console.log('Done!');
