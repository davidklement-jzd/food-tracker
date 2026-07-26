import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, todayStr } from '../utils/dates';

function prevDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return toDateStr(dt);
}

// Spočítá aktuální sérii po sobě jdoucích dní s aspoň jedním zapsaným jídlem.
// Série „žije" celý dnešek: pokud je poslední zapsaný den dnešek NEBO včerejšek,
// série platí (dnešní den ještě neskončil). Až když klientka vynechá celý den,
// série se resetuje na 0.
export function computeStreak(loggedDates, today = todayStr()) {
  const set = loggedDates instanceof Set ? loggedDates : new Set(loggedDates);
  let cursor = today;
  if (!set.has(cursor)) {
    cursor = prevDateStr(cursor); // dnes ještě nezapsáno → série může běžet od včerejška
    if (!set.has(cursor)) return 0;
  }
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = prevDateStr(cursor);
  }
  return streak;
}

// refreshSignal: když se změní (např. počet dnešních záznamů), série se přepočítá,
// takže po zapsání prvního dnešního jídla medaile hned naskočí.
export function useStreak(userId, refreshSignal) {
  const [streak, setStreak] = useState(0);
  const [loggedToday, setLoggedToday] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setStreak(0);
      setLoggedToday(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStreak() {
      setLoading(true);
      // Jen dny s aspoň jedním záznamem jídla — !inner odfiltruje prázdné diary_days.
      const { data, error } = await supabase
        .from('diary_days')
        .select('date, diary_entries!inner(id)')
        .eq('user_id', userId);

      if (cancelled) return;

      if (error) {
        console.error('Error fetching streak:', error);
        setLoading(false);
        return;
      }

      const dates = new Set((data || []).map((row) => row.date));
      const today = todayStr();
      setLoggedToday(dates.has(today));
      setStreak(computeStreak(dates, today));
      setLoading(false);
    }

    fetchStreak();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshSignal]);

  return { streak, loggedToday, loading };
}
