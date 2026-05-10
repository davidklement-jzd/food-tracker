// Pomocné funkce pro zápis změn cílů do tabulky `goal_history`.
// Používá se ze SettingsPage (trenér edituje klientku) i z AuthContext
// (klientka edituje sama sebe).
//
// Klíčová logika:
//  1. UPSERT dnešní řádek se VŠEMI 5 novými cíli.
//  2. „First-edit" backfill: pokud pro klientku NEEXISTUJE žádný řádek
//     v goal_history s datem < dnes, vlož STARTER řádek s STARÝMI
//     hodnotami z profilu, datovaný klientčiným prvním zápisem v deníku
//     (nebo její account creation, případně fallback `1970-01-01`).
//     Tím se zaručí, že předchozí dny si zachovají původní hodnotu.
//
// Sloupce v goal_history přibyly v migraci 023_goal_history_full.sql
// (dříve byl jen goal_kcal). Helper je vždy zapisuje všechny.

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

/**
 * Vloží/aktualizuje dnešní řádek s novými cíli. Pokud jde o první
 * úpravu cílů u klientky, vloží i „starter" řádek se starými hodnotami,
 * aby předchozí dny zůstaly korektní.
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

  // Krok 2: zjisti, jestli existuje nějaký dřívější řádek (date < today).
  const { data: earlier } = await supabase
    .from('goal_history')
    .select('id')
    .eq('user_id', userId)
    .lt('date', today)
    .limit(1);

  if (earlier && earlier.length > 0) return; // Backfill není potřeba.

  // Krok 3: backfill — najdi datum prvního zápisu v deníku, nebo profile.created_at,
  // nebo fallback na 1970-01-01.
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

  // Pokud by starter spadl na dnešek (klientka je úplně nová a deník začala dnes),
  // posuneme ho o den zpět, ať dnešní upsert neoverwriteneme.
  if (starterDate === today) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    starterDate = d.toISOString().split('T')[0];
  }

  const oldGoals = pickGoals(oldProfile);
  if (Object.keys(oldGoals).length === 0) return;

  const { error: starterErr } = await supabase.from('goal_history').upsert(
    { user_id: userId, date: starterDate, ...oldGoals },
    { onConflict: 'user_id,date' },
  );
  if (starterErr && oldGoals.goal_kcal != null) {
    await supabase.from('goal_history').upsert(
      { user_id: userId, date: starterDate, goal_kcal: oldGoals.goal_kcal },
      { onConflict: 'user_id,date' },
    );
  }
}
