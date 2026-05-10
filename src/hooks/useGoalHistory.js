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

// Najde poslední řádek v history s date <= dateStr, vrátí jeho hodnotu pro daný klíč.
// Pokud žádný takový není, vrátí fallback. Sloupec v history může být NULL
// (starší řádky před migrací 023 měly jen goal_kcal) — pak se hledá hlouběji
// nebo se použije fallback.
export function getGoalForDate(dateStr, goalHistory, fallback, key = 'goal_kcal') {
  let goal = fallback;
  for (const entry of goalHistory) {
    if (entry.date <= dateStr) {
      const val = entry[key];
      if (val != null) goal = val;
    } else {
      break;
    }
  }
  return goal;
}

// Vrátí všech 5 cílů pro daný den jako objekt. fallbackProfile je celý profil
// klientky (nebo libovolný objekt s goal_* poli) — slouží jako poslední záchrana,
// když v history pro daný klíč není ani jeden řádek <= dateStr.
export function getAllGoalsForDate(dateStr, goalHistory, fallbackProfile = {}) {
  const out = {};
  for (const key of GOAL_KEYS) {
    out[key] = getGoalForDate(dateStr, goalHistory, fallbackProfile?.[key], key);
  }
  return out;
}
