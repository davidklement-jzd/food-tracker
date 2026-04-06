import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useGoalHistory(userId) {
  const [goalHistory, setGoalHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('goal_history')
      .select('goal_kcal, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    setGoalHistory(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { goalHistory, goalLoading: loading };
}

// Given a date string and goal history array, find the goal_kcal valid for that date
export function getGoalForDate(dateStr, goalHistory, fallback) {
  let goal = fallback;
  for (const entry of goalHistory) {
    if (entry.date <= dateStr) {
      goal = entry.goal_kcal;
    } else {
      break;
    }
  }
  return goal;
}
