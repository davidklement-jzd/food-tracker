// Pomocné funkce pro zápis změn cílů do tabulky `goal_history`.
// Používá se ze SettingsPage (trenér edituje klientku) i z AuthContext
// (klientka edituje sama sebe).
//
// Klíčová logika:
//  1. UPSERT dnešní řádek se VŠEMI 5 novými cíli.
//  2. „First-edit" backfill PER KLÍČ:
//     pro každý cíl (kcal, protein, carbs, fat, fiber) zvlášť ověříme,
//     jestli existuje dřívější řádek s vyplněnou hodnotou pro tento klíč.
//     Pokud NE a starý profil tu hodnotu má, doplníme ji do starter řádku
//     datovaného klientčiným prvním zápisem v deníku (nebo created_at
//     profilu, fallback `1970-01-01`).
//
//     Per-klíč backfill řeší i případ klientek, které měly v history
//     jen goal_kcal (legacy stav před migrací 023). Tj. kcal historie
//     zůstane, ostatní 4 makra se doplní starterem.

import { supabase } from './supabase';

const GOAL_KEYS = ['goal_kcal', 'goal_protein', 'goal_carbs', 'goal_fat', 'goal_fiber'];

function pickGoals(obj) {
  const out = {};
  for (const k of GOAL_KEYS) {
    if (obj?.[k] != null) out[k] = obj[k];
  }
  return out;
}

function isoToday() {
  return new Date().toISOString().split('T')[0];
}

async function findStarterDate(userId, oldProfile, today) {
  let starterDate = '1970-01-01';
  const { data: firstDiary } = await supabase
    .from('diary_days')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstDiary?.date) {
    starterDate = firstDiary.date;
  } else if (oldProfile?.created_at) {
    starterDate = oldProfile.created_at.split('T')[0];
  }
  // Pokud by starter spadl na dnešek nebo později, posuň o den zpět,
  // ať nepřepíšeme dnešní řádek s novými hodnotami.
  if (starterDate >= today) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    starterDate = d.toISOString().split('T')[0];
  }
  return starterDate;
}

/**
 * Vloží/aktualizuje dnešní řádek s novými cíli a zajistí backfill starých
 * hodnot per-klíč, aby předchozí dny zůstaly korektní.
 *
 * @param {string} userId — ID klientky
 * @param {object} oldProfile — profil PŘED uložením (pro starter řádek)
 * @param {object} newGoals — nové goal_* hodnoty (z formuláře)
 */
export async function logGoalChange(userId, oldProfile, newGoals) {
  if (!userId) return;
  const newRow = pickGoals(newGoals);
  if (Object.keys(newRow).length === 0) return;

  const today = isoToday();

  // Krok 1: upsert dnešní řádek s novými hodnotami.
  // Pokud nové sloupce ještě nejsou v DB (migrace 023 nedoběhla), zopakuj
  // upsert jen s goal_kcal — aby se aspoň kcal zalogovalo (legacy chování).
  const { error: upsertErr } = await supabase.from('goal_history').upsert(
    { user_id: userId, date: today, ...newRow },
    { onConflict: 'user_id,date' },
  );
  if (upsertErr && newRow.goal_kcal != null) {
    await supabase.from('goal_history').upsert(
      { user_id: userId, date: today, goal_kcal: newRow.goal_kcal },
      { onConflict: 'user_id,date' },
    );
  }

  // Krok 2: per-klíč backfill — pro každý cíl zvlášť zjisti, jestli existuje
  // dřívější řádek (date < today) s vyplněnou hodnotou pro tento klíč.
  const oldGoals = pickGoals(oldProfile);
  const keysNeedingBackfill = [];

  for (const key of GOAL_KEYS) {
    if (oldGoals[key] == null) continue; // Není čím doplnit.
    const { data: earlier } = await supabase
      .from('goal_history')
      .select('id')
      .eq('user_id', userId)
      .lt('date', today)
      .not(key, 'is', null)
      .limit(1);
    if (!earlier || earlier.length === 0) {
      keysNeedingBackfill.push(key);
    }
  }

  if (keysNeedingBackfill.length === 0) return;

  // Krok 3: vlož starter řádek pro klíče, které backfill potřebují.
  // (Pokud už pro ten datum řádek existuje, upsert ho dorovná.)
  const starterDate = await findStarterDate(userId, oldProfile, today);
  const starterRow = { user_id: userId, date: starterDate };
  for (const key of keysNeedingBackfill) starterRow[key] = oldGoals[key];

  const { error: starterErr } = await supabase
    .from('goal_history')
    .upsert(starterRow, { onConflict: 'user_id,date' });
  if (starterErr && starterRow.goal_kcal != null) {
    // Fallback pro stav před migrací 023.
    await supabase.from('goal_history').upsert(
      { user_id: userId, date: starterDate, goal_kcal: starterRow.goal_kcal },
      { onConflict: 'user_id,date' },
    );
  }
}
