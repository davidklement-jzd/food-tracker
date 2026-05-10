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
//    který má hodnotu pro tento klíč. Pokud nic, fallback.
//
// Tím vyřešíme i klientky, kde profile.goal_* ≠ poslední row v history
// (typické pro úpravy provedené před zavedením historizace).
export function getGoalForDate(dateStr, goalHistory, fallback, key = 'goal_kcal') {
  if (dateStr >= isoToday()) return fallback ?? null;
  let goal = fallback;
  for (const entry of goalHistory || []) {
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
// klientky (nebo libovolný objekt s goal_* poli).
export function getAllGoalsForDate(dateStr, goalHistory, fallbackProfile = {}) {
  const out = {};
  for (const key of GOAL_KEYS) {
    out[key] = getGoalForDate(dateStr, goalHistory, fallbackProfile?.[key], key);
  }
  return out;
}
