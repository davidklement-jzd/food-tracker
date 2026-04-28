#!/usr/bin/env node
// Doplní vlákninu (`fiber`) ve `diary_entries`, kde je 0, ale spárovaná
// potravina v `foods` má vlákninu > 0. Přepisuje jen 0 → kladná hodnota,
// nikdy nezahodí ručně zapsanou nenulovou hodnotu.
//
// Vyžaduje:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backfill-entry-fiber.mjs --dry-run
//   (poté bez --dry-run pro skutečný zápis)
//
// Volitelné argumenty:
//   --match=id       (default) matchuje jen entries s vyplněným food_id
//   --match=name     matchuje entries BEZ food_id přes shodu name+brand;
//                    spáruje jen pokud je v foods PRÁVĚ JEDEN match (jednoznačnost)
//   --match=both     obojí v jednom běhu

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);
const DRY_RUN = !!args['dry-run'];
const MATCH = args.match || 'id'; // 'id' | 'name' | 'both'
if (!['id', 'name', 'both'].includes(MATCH)) {
  console.error(`Neplatná hodnota --match=${MATCH}. Použij id, name, nebo both.`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function fetchEntriesNeedingFiber({ withFoodId }) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('diary_entries')
      .select('id, name, brand, grams, fiber, food_id')
      .eq('fiber', 0);
    q = withFoodId ? q.not('food_id', 'is', null) : q.is('food_id', null);
    q = q.order('id').range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAllFoodsWithFiber() {
  // Načteme všechny foods záznamy s vlákninou > 0 jednou — používá se pro
  // všechny varianty matche.
  const { data, error } = await supabase
    .from('foods')
    .select('title, brand, fiber')
    .gt('fiber', 0);
  if (error) throw error;
  return data || [];
}

function buildFoodIndexes(foods) {
  // Tři indexy podle různých klíčů. Hodnota = { fiber, count }.
  const byNameBrand = new Map();      // exact name+brand (lower, no diacritics)
  const byNameOnly = new Map();       // exact name (lower, no diacritics)
  for (const row of foods) {
    const name = normalizeName(row.title);
    const brand = normalizeName(row.brand);
    if (!name) continue;
    const k1 = `${name}||${brand}`;
    const c1 = byNameBrand.get(k1);
    if (!c1) byNameBrand.set(k1, { fiber: row.fiber, count: 1 });
    else { c1.count++; c1.fiber = row.fiber; }

    const c2 = byNameOnly.get(name);
    if (!c2) byNameOnly.set(name, { fiber: row.fiber, count: 1 });
    else { c2.count++; c2.fiber = row.fiber; }
  }
  return { byNameBrand, byNameOnly };
}

async function fetchFoodsByIds(ids) {
  const map = new Map();
  const PAGE = 500;
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('foods')
      .select('id, fiber')
      .in('id', slice);
    if (error) throw error;
    for (const row of data || []) {
      if (typeof row.fiber === 'number' && row.fiber > 0) {
        map.set(row.id, row.fiber);
      }
    }
  }
  return map;
}

function buildEntryUpdate(entry, fiberPer100g) {
  const grams = Number(entry.grams) || 0;
  if (grams <= 0) return null;
  // V diary_entries je vláknina v gramech POLOŽKY, ne na 100 g — viz schema
  // (ostatní makra jsou taky v g položky). Přepočet z foods (g/100g):
  const newFiber = Math.round(((fiberPer100g * grams) / 100) * 10) / 10;
  if (newFiber <= 0) return null;
  return { id: entry.id, name: entry.name, grams, oldFiber: entry.fiber, newFiber };
}

async function collectIdMatches() {
  console.log(`\n— Pass: id-match (food_id IS NOT NULL) —`);
  const entries = await fetchEntriesNeedingFiber({ withFoodId: true });
  console.log(`Kandidáti: ${entries.length}`);
  if (entries.length === 0) return [];

  const uniqueFoodIds = [...new Set(entries.map((e) => e.food_id))];
  console.log(`Foods k načtení: ${uniqueFoodIds.length}`);
  const foodFiber = await fetchFoodsByIds(uniqueFoodIds);
  console.log(`Z toho s fiber > 0: ${foodFiber.size}`);

  const updates = [];
  for (const e of entries) {
    const fiberPer100g = foodFiber.get(e.food_id);
    if (!fiberPer100g) continue;
    const u = buildEntryUpdate(e, fiberPer100g);
    if (u) updates.push(u);
  }
  return updates;
}

async function collectNameMatches() {
  console.log(`\n— Pass: name-match (food_id IS NULL) —`);
  const entries = await fetchEntriesNeedingFiber({ withFoodId: false });
  console.log(`Kandidáti: ${entries.length}`);
  if (entries.length === 0) return [];

  const foods = await fetchAllFoodsWithFiber();
  const { byNameBrand, byNameOnly } = buildFoodIndexes(foods);

  const updates = [];
  let hitNameBrand = 0;
  let hitNameOnly = 0;
  const unmatched = [];

  for (const e of entries) {
    const name = normalizeName(e.name);
    const brand = normalizeName(e.brand || '');
    let fiber = null;

    const a = byNameBrand.get(`${name}||${brand}`);
    if (a && a.count === 1) { fiber = a.fiber; hitNameBrand++; }

    if (fiber == null) {
      const b = byNameOnly.get(name);
      if (b && b.count === 1) { fiber = b.fiber; hitNameOnly++; }
    }

    if (fiber == null) {
      unmatched.push(e);
      continue;
    }
    const u = buildEntryUpdate(e, fiber);
    if (u) updates.push(u);
  }

  console.log(`Shod přes name+brand: ${hitNameBrand}`);
  console.log(`Shod přes name-only:   ${hitNameOnly}`);
  console.log(`Bez shody:             ${unmatched.length}`);
  if (DRY_RUN && unmatched.length > 0) {
    console.log(`\nNespárované kandidáti (vypisuji do 30):`);
    for (const e of unmatched.slice(0, 30)) {
      console.log(`  "${e.name}"${e.brand ? ` [${e.brand}]` : ''}  (${e.grams} g)`);
    }
    if (unmatched.length > 30) console.log(`  … a dalších ${unmatched.length - 30}`);
  }

  return updates;
}

async function main() {
  console.log(`Backfill diary_entries.fiber, mode=match=${MATCH}${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const updates = [];
  if (MATCH === 'id' || MATCH === 'both') {
    updates.push(...(await collectIdMatches()));
  }
  if (MATCH === 'name' || MATCH === 'both') {
    updates.push(...(await collectNameMatches()));
  }

  console.log(`\nK úpravě celkem: ${updates.length} entries.`);
  if (updates.length === 0) {
    console.log('Nic k práci. Hotovo.');
    return;
  }

  if (DRY_RUN) {
    for (const u of updates.slice(0, 80)) {
      console.log(`  ${u.oldFiber} → ${u.newFiber} g  (${u.grams} g)  ${u.name}`);
    }
    if (updates.length > 80) console.log(`  … a dalších ${updates.length - 80}`);
    console.log('\nDRY RUN: do DB nezapsáno.');
    return;
  }

  let done = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('diary_entries')
      .update({ fiber: u.newFiber })
      .eq('id', u.id);
    if (error) console.error(`Update ${u.id} error:`, error.message);
    else done++;
  }
  console.log(`\nHotovo. Opraveno ${done} / ${updates.length} entries.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
