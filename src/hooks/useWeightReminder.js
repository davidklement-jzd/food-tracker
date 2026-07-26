import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { todayStr } from '../utils/dates';

const THRESHOLD_DAYS = 7;

function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

// Připomenutí zapsání váhy. overdue=true, když má klientka aspoň jednu zapsanou
// váhu a od poslední uplynulo >= 7 dní. Nová klientka bez historie (žádná váha
// nikdy zapsaná) upozornění NEDOSTANE — není se od čeho počítat, takže se nová
// klientka neotravuje. Počítá se od skutečné poslední váhy, ne od registrace.
export function useWeightReminder(userId, refreshSignal) {
  const [days, setDays] = useState(0);
  const [overdue, setOverdue] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setOverdue(false);
      setDays(0);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchLatest() {
      setLoading(true);
      const { data, error } = await supabase
        .from('weight_entries')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('Error fetching weight reminder:', error);
        setLoading(false);
        return;
      }

      if (!data) {
        // Žádná zapsaná váha (nová klientka) → neupozorňujeme.
        setOverdue(false);
        setDays(0);
        setLoading(false);
        return;
      }

      const d = daysBetween(data.date, todayStr());
      setDays(d);
      setOverdue(d >= THRESHOLD_DAYS);
      setLoading(false);
    }

    fetchLatest();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshSignal]);

  return { overdue, days, loading };
}
