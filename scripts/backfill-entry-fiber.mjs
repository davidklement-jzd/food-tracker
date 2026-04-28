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

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);
const DRY_RUN = !!args['dry-run'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function fetchEntriesNeedingFiber() {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('diary_entries')
      .select('id, name, grams, fiber, food_id')
      .eq('fiber', 0)
      .not('food_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
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

async function main() {
  console.log(`Načítám diary_entries s fiber = 0 a vyplněným food_id${DRY_RUN ? ' [DRY RUN]' : ''}…`);
  const entries = await fetchEntriesNeedingFiber();
  console.log(`Kandidáti na opravu: ${entries.length}`);
  if (entries.length === 0) {
    console.log('Nic k práci. Hotovo.');
    return;
  }

  const uniqueFoodIds = [...new Set(entries.map((e) => e.food_id))];
  console.log(`Načítám aktuální vlákninu pro ${uniqueFoodIds.length} potravin z foods…`);
  const foodFiber = await fetchFoodsByIds(uniqueFoodIds);
  console.log(`Z toho s fiber > 0 ve foods: ${foodFiber.size}`);

  const updates = [];
  for (const e of entries) {
    const fiberPer100g = foodFiber.get(e.food_id);
    if (!fiberPer100g) continue;
    const grams = Number(e.grams) || 0;
    if (grams <= 0) continue;
    // V diary_entries je vláknina v gramech POLOŽKY, ne na 100 g — viz schema
    // (ostatní makra jsou taky v g položky). Přepočet z foods (g/100g):
    const newFiber = Math.round(((fiberPer100g * grams) / 100) * 10) / 10;
    if (newFiber <= 0) continue;
    updates.push({ id: e.id, name: e.name, grams, oldFiber: e.fiber, newFiber });
  }

  console.log(`K úpravě: ${updates.length} entries.`);

  if (DRY_RUN) {
    for (const u of updates.slice(0, 50)) {
      console.log(`  ${u.oldFiber} → ${u.newFiber} g  (${u.grams} g)  ${u.name}`);
    }
    if (updates.length > 50) console.log(`  … a dalších ${updates.length - 50}`);
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
