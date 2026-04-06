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

    // Get all entries for those days
    const { data: entries } = await supabase
      .from('diary_entries')
      .select('day_id, kcal')
      .in('day_id', dayIds);

    // Sum kcal per day
    const kcalByDayId = {};
    for (const e of entries || []) {
      kcalByDayId[e.day_id] = (kcalByDayId[e.day_id] || 0) + (e.kcal || 0);
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
