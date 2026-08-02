import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useCalorieHistory(userId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;

    // Get all diary_days for this user
    const { data: days, error: daysErr } = await supabase
      .from('diary_days')
      .select('id, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (daysErr || !days?.length) {
      setData([]);
      setLoading(false);
      return;
    }

    const dayIds = days.map((d) => d.id);

    // Get all entries for those days. POZOR: PostgREST vrací max ~1000 řádků na
    // jeden dotaz, takže u klientek s >1000 položkami se dřív graf tiše ořízl –
    // nejnovější dny přišly o část položek a jevily se jako „pod cílem". Proto
    // stránkujeme přes .range() se stabilním řazením podle id, dokud nedojdou.
    const PAGE = 1000;
    const kcalByDayId = {};
    for (let from = 0; ; from += PAGE) {
      const { data: batch, error: entErr } = await supabase
        .from('diary_entries')
        .select('day_id, kcal')
        .in('day_id', dayIds)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);

      if (entErr || !batch?.length) break;

      for (const e of batch) {
        kcalByDayId[e.day_id] = (kcalByDayId[e.day_id] || 0) + (e.kcal || 0);
      }

      if (batch.length < PAGE) break;
    }

    // Build result: only days that have entries
    const result = days
      .filter((d) => kcalByDayId[d.id] > 0)
      .map((d) => ({
        date: d.date,
        kcal: Math.round(kcalByDayId[d.id]),
      }));

    setData(result);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { calorieHistory: data, calorieLoading: loading };
}
