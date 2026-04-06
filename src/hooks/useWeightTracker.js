import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useWeightTracker(userId, selectedDate) {
  const [weightForDate, setWeightForDate] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch the weight valid for selectedDate (last entry on or before that date)
  const fetchForDate = useCallback(async () => {
    if (!userId || !selectedDate) return;
    const { data } = await supabase
      .from('weight_entries')
      .select('weight, date')
      .eq('user_id', userId)
      .lte('date', selectedDate)
      .order('date', { ascending: false })
      .limit(1)
      .single();
    setWeightForDate(data || null);
    setLoading(false);
  }, [userId, selectedDate]);

  const fetchHistory = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('weight_entries')
      .select('weight, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    setHistory(data || []);
  }, [userId]);

  useEffect(() => {
    fetchForDate();
    fetchHistory();
  }, [fetchForDate, fetchHistory]);

  async function saveWeight(weight) {
    if (!userId) return;
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('weight_entries')
      .upsert(
        { user_id: userId, weight, date: today },
        { onConflict: 'user_id,date' }
      );
    if (!error) {
      fetchForDate();
      fetchHistory();
    }
    return { error };
  }

  return { weightForDate, history, loading, saveWeight };
}
