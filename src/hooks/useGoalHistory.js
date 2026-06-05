import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const GOAL_KEYS = ['goal_kcal', 'goal_protein', 'goal_carbs', 'goal_fat', 'goal_fiber'];

export function useGoalHistory(userId) {
  const [goalHistory, setGoalHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    // Snažíme se načíst všech 5 cílů (po migraci 023). Pokud sloupce ještě
    // neexistují v DB (migrace nedoběhla), retry se starým schématem (jen kcal).
    let { data, error } = await supabase
      .from('goal_history')
      .select('goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    if (error) {
      const fallback = await supabase
        .from('goal_history')
        .select('goal_kcal, date')
        .eq('user_id', userId)
        .order('date', { ascending: true });
      data = fallback.data;
    }
    setGoalHistory(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { goalHistory, goalLoading: loading, refetchGoalHistory: fetch };
}

function isoToday() {
  return new Date().toISOString().split('T')[0];
}

// Vrátí cíl pro daný den a klíč.
//
// Logika:
//  - DNES a DOPŘEDU → fallback (= profile.goal_*). Profil je aktuální pravda;
//    cíl právě nastavený (i bez záznamu v history) má platit.
//  - MINULÉ DNY → walk history: najít poslední řádek s date <= dateStr,
//    který má hodnotu pro tento klíč.
//      • Pokud žádný takový není (den je před prvním záznamem pro tento klíč),
//        použít NEJSTARŠÍ známou hodnotu z history — NE aktuální profil.
//      • Teprve když pro klíč neexistuje v history vůbec žádná hodnota,
//        spadnout na fallback (profil).
//
// Proč pro minulost nikdy nesahat na aktuální profil:
//   Dřív minulé dny braly chybějící hodnotu z profilu. To znamenalo, že každá
//   budoucí změna cíle se zpětně propsala do všech minulých dní bez záznamu
//   (typicky makra ve starých řádcích, kde se ukládaly jen kalorie). Pinnutím
//   na nejstarší zaznamenanou hodnotu zůstane minulost stabilní napříč
//   budoucími změnami profilu.
export function getGoalForDate(dateStr, goalHistory, fallback, key = 'goal_kcal') {
  if (dateStr >= isoToday()) return fallback ?? null;
  let walked = null;     // poslední non-null hodnota s date <= dateStr
  let earliest = null;   // úplně první (nejstarší) non-null hodnota v history
  for (const entry of goalHistory || []) {
    const val = entry[key];
    if (val == null) continue;
    if (earliest === null) earliest = val; // history je řazená vzestupně podle date
    if (entry.date <= dateStr) walked = val;
  }
  if (walked !== null) return walked;
  if (earliest !== null) return earliest;
  return fallback ?? null;
}

// Vrátí všech 5 cílů pro daný den jako objekt. fallbackProfile je celý profil
// klientky (nebo libovolný objekt s goal_* poli).
export function getAllGoalsForDate(dateStr, goalHistory, fallbackProfile = {}) {
  const out = {};
  for (const key of GOAL_KEYS) {
    out[key] = getGoalForDate(dateStr, goalHistory, fallbackProfile?.[key], key);
  }
  return out;
}
