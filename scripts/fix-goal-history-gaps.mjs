#!/usr/bin/env node
// Jednorázový fix pro klientky s "gap" v goal_history.
//
// Background: před migrací 023 a logikou gap-aware backfillu mohlo dojít k tomu,
// že trenér změnil cíl v profilu, ale do goal_history se to nezalogovalo
// (legacy stav). Důsledek: past days zobrazují hodnotu posledního history
// řádku, ne tu, která byla efektivně v profilu před tímto fixem.
//
// Skript projde všechny klientky a pro každý cíl (kcal/protein/carbs/fat/fiber)
// zvlášť:
//  1. Načte aktuální profile.goal_<key>.
//  2. Najde nejnovější dřívější (date < today) goal_history řádek s hodnotou
//     pro tento klíč.
//  3. Pokud profil.value ≠ history.value (nebo history neexistuje), je tu
//     "gap" — vlož backfill řádek:
//     - na den po posledním history řádku (pokud existuje),
//     - nebo na klientčin první diary day.
//     Hodnota = aktuální profile (= „co reálně bylo nastaveno mezi posledním
//     logovaným změnami a dneškem").
//
// Vyžaduje:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/fix-goal-history-gaps.mjs --dry-run
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

const GOAL_KEYS = ['goal_kcal', 'goal_protein', 'goal_carbs', 'goal_fat', 'goal_fiber'];

function isoToday() {
  return new Date().toISOString().split('T')[0];
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function findFirstDiaryOrCreated(userId, profile, today) {
  let date = '1970-01-01';
  const { data: firstDiary } = await supabase
    .from('diary_days')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstDiary?.date) {
    date = firstDiary.date;
  } else if (profile?.created_at) {
    date = profile.created_at.split('T')[0];
  }
  if (date >= today) date = addDays(today, -1);
  return date;
}

async function fixClient(profile) {
  const today = isoToday();
  const userId = profile.id;
  const inserts = []; // pro reporting

  for (const key of GOAL_KEYS) {
    const profileVal = profile[key];
    if (profileVal == null) continue;

    const { data: latestEarlier } = await supabase
      .from('goal_history')
      .select(`date, ${key}`)
      .eq('user_id', userId)
      .lt('date', today)
      .not(key, 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const walkValue = latestEarlier?.[key] ?? null;
    if (walkValue === profileVal) continue; // gap == 0

    let backfillDate;
    if (latestEarlier?.date) {
      backfillDate = addDays(latestEarlier.date, 1);
      if (backfillDate >= today) continue;
    } else {
      backfillDate = await findFirstDiaryOrCreated(userId, profile, today);
    }

    inserts.push({ key, backfillDate, value: profileVal, prevValue: walkValue, prevDate: latestEarlier?.date ?? null });

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('goal_history')
        .upsert(
          { user_id: userId, date: backfillDate, [key]: profileVal },
          { onConflict: 'user_id,date' },
        );
      if (error) console.error(`  ${profile.display_name} ${key}: upsert error:`, error.message);
    }
  }

  return inserts;
}

async function main() {
  console.log(`Fix goal_history gaps${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, display_name, created_at, goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber')
    .eq('role', 'client');
  if (error) throw error;

  let totalInserts = 0;
  for (const p of profiles) {
    const inserts = await fixClient(p);
    if (inserts.length === 0) continue;
    totalInserts += inserts.length;
    console.log(`${p.display_name}:`);
    for (const ins of inserts) {
      const prev = ins.prevDate ? `${ins.prevDate}=${ins.prevValue}` : '—';
      console.log(`  ${ins.key}: backfill ${ins.backfillDate} = ${ins.value}   (prev: ${prev})`);
    }
  }

  console.log(`\n${DRY_RUN ? 'Bylo by inserted' : 'Insertováno'}: ${totalInserts} backfill řádků napříč ${profiles.length} klientkami.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
