import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useActivityDiary(userId, selectedDate) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dayId, setDayId] = useState(null);

  useEffect(() => {
    if (!userId || !selectedDate) return;
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      const { data: dayRow } = await supabase
        .from('diary_days')
        .select('id')
        .eq('user_id', userId)
        .eq('date', selectedDate)
        .single();

      if (cancelled) return;

      if (!dayRow) {
        setActivities([]);
        setDayId(null);
        setLoading(false);
        return;
      }

      setDayId(dayRow.id);

      const { data: entries } = await supabase
        .from('activity_entries')
        .select('*')
        .eq('day_id', dayRow.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (!cancelled) {
        setActivities(entries || []);
        setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [userId, selectedDate]);

  const ensureDayId = useCallback(async () => {
    if (dayId) return dayId;
    const { data } = await supabase
      .from('diary_days')
      .upsert({ user_id: userId, date: selectedDate }, { onConflict: 'user_id,date' })
      .select('id')
      .single();
    if (data) setDayId(data.id);
    return data?.id;
  }, [dayId, userId, selectedDate]);

  const addActivity = useCallback(async (entry) => {
    const id = await ensureDayId();
    if (!id) return;

    const { data, error } = await supabase
      .from('activity_entries')
      .insert({
        day_id: id,
        name: entry.name,
        duration: entry.duration,
        kcal_burned: entry.kcal_burned,
        sort_order: activities.length,
      })
      .select()
      .single();

    if (!error && data) {
      setActivities((prev) => [...prev, data]);
    }
  }, [ensureDayId, activities.length]);

  const removeActivity = useCallback(async (entryId) => {
    const { error } = await supabase
      .from('activity_entries')
      .delete()
      .eq('id', entryId);

    if (!error) {
      setActivities((prev) => prev.filter((a) => a.id !== entryId));
    }
  }, []);

  const updateActivity = useCallback(async (entryId, updates) => {
    const dbUpdates = {};
    if (updates.duration != null) dbUpdates.duration = updates.duration;
    if (updates.kcal_burned != null) dbUpdates.kcal_burned = updates.kcal_burned;
    if (updates.note != null) dbUpdates.note = updates.note;
    const { error } = await supabase
      .from('activity_entries')
      .update(dbUpdates)
      .eq('id', entryId);

    if (!error) {
      setActivities((prev) => prev.map((a) =>
        a.id === entryId ? { ...a, ...updates } : a
      ));
    }
  }, []);

  return { activities, loading, addActivity, removeActivity, updateActivity };
}
