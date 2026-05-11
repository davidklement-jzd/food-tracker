// Pomocné funkce pro zápis změn cílů do tabulky `goal_history`.
// Používá se ze SettingsPage (trenér edituje klientku) i z AuthContext
// (klientka edituje sama sebe).
//
// Klíčová logika (gap-aware per-klíč backfill):
//
//   1. UPSERT dnešní řádek se VŠEMI 5 novými cíli.
//   2. Pro každý cíl (kcal, protein, carbs, fat, fiber) zvlášť:
//      a) Najdi nejnovější řádek v history s date < dnes, který má hodnotu
//         pro tento klíč. Pokud žádný neexistuje, walks pro včerejšek by
//         vrátil null/fallback.
//      b) Pokud `latestEarlier.value` ≠ `oldProfile[key]` (nebo neexistuje),
//         je tu GAP — někdy mezi posledním history řádkem a dnes profil
//         dostal jinou hodnotu (`oldProfile[key]`), ale nezalogovala se.
//         Backfilluj tu hodnotu, aby walks pro past days v gapu vracely
//         správnou hodnotu.
//      c) Backfill se inserí:
//         - na den po `latestEarlier.date`, pokud existuje (vyplní gap od
//           následujícího dne dál),
//         - nebo na klientčin první diary day (case "úplně nová history").
//      d) Pokud `latestEarlier.value` == `oldProfile[key]`, žádný gap.
//
// Tahle logika zaručuje: po každé úpravě profilu past days v gap mezi
// poslední historickou změnou a dneškem dostanou hodnotu, která tam před
// úpravou ve skutečnosti efektivně platila (= oldProfileSnapshot).

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

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function findFirstDiaryOrCreated(userId, oldProfile, today) {
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
  } else if (oldProfile?.created_at) {
    date = oldProfile.created_at.split('T')[0];
  }
  // Pokud by starter spadl na dnešek nebo později, posuň o den zpět.
  if (date >= today) {
    date = addDays(today, -1);
  }
  return date;
}

/**
 * Vloží/aktualizuje dnešní řádek s novými cíli a per-klíč backfill „gap"
 * tak, aby past days dostaly hodnoty, které tam efektivně platily.
 *
 * @param {string} userId — ID klientky
 * @param {object} oldProfile — profil PŘED uložením (klíč pro gap-detect)
 * @param {object} newGoals — nové goal_* hodnoty (z formuláře)
 */
export async function logGoalChange(userId, oldProfile, newGoals) {
  if (!userId) return;
  const newRow = pickGoals(newGoals);
  if (Object.keys(newRow).length === 0) return;

  const today = isoToday();

  // Krok 1: upsert dnešní řádek s novými hodnotami.
  // Pokud sloupce ještě nejsou v DB (migrace 023 nedoběhla), retry jen
  // s goal_kcal — legacy graceful fallback.
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

  // Krok 2: per-klíč gap-aware backfill.
  const oldGoals = pickGoals(oldProfile);

  for (const key of GOAL_KEYS) {
    if (oldGoals[key] == null) continue;

    // Najdi nejnovější dřívější řádek s vyplněnou hodnotou pro tento klíč.
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
    if (walkValue === oldGoals[key]) {
      // Žádný gap — co walks vrátí pro včerejšek, sedí s oldProfile.
      continue;
    }

    // Je tu gap — vlož backfill řádek se starou hodnotou.
    let backfillDate;
    if (latestEarlier?.date) {
      backfillDate = addDays(latestEarlier.date, 1);
      // Pokud by backfill spadl na dnešek nebo později, dnešní řádek to už
      // pokrývá — gap má nulovou délku, neřešit.
      if (backfillDate >= today) continue;
    } else {
      backfillDate = await findFirstDiaryOrCreated(userId, oldProfile, today);
    }

    const { error: backfillErr } = await supabase
      .from('goal_history')
      .upsert(
        { user_id: userId, date: backfillDate, [key]: oldGoals[key] },
        { onConflict: 'user_id,date' },
      );
    if (backfillErr) {
      // Pokud klíč ještě neexistuje v DB (migrace 023 nedoběhla), tichý fail.
      // U kcal to neřešíme, protože ten sloupec existoval odjakživa.
      // eslint-disable-next-line no-console
      console.warn(`goal_history backfill ${key} failed:`, backfillErr.message);
    }
  }
}
