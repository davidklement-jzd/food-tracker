import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useClientList() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, created_at')
        .eq('role', 'client')
        .order('display_name');

      if (error) {
        console.error('Error fetching clients:', error);
      } else {
        setClients(data || []);
      }
      setLoading(false);
    }
    fetch();
  }, []);

  return { clients, loading };
}

export function useClientDiary(clientId, selectedDate) {
  const [dayData, setDayData] = useState({});
  const [dayId, setDayId] = useState(null);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId || !selectedDate) {
      setDayData({});
      setDayId(null);
      setComments({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchDay() {
      setLoading(true);

      const { data: dayRow } = await supabase
        .from('diary_days')
        .select('id')
        .eq('user_id', clientId)
        .eq('date', selectedDate)
        .single();

      if (cancelled) return;

      if (!dayRow) {
        setDayData({});
        setDayId(null);
        setComments({});
        setLoading(false);
        return;
      }

      setDayId(dayRow.id);

      const [entriesRes, notesRes, commentsRes] = await Promise.all([
        supabase
          .from('diary_entries')
          .select('*')
          .eq('day_id', dayRow.id)
          .order('sort_order')
          .order('created_at'),
        supabase
          .from('meal_notes')
          .select('*')
          .eq('day_id', dayRow.id),
        supabase
          .from('trainer_comments')
          .select('*')
          .eq('day_id', dayRow.id),
      ]);

      if (cancelled) return;

      // Build dayData
      const data = {};
      for (const entry of entriesRes.data || []) {
        if (!data[entry.meal_id]) data[entry.meal_id] = [];
        data[entry.meal_id].push({
          id: entry.id,
          name: entry.name,
          brand: entry.brand,
          grams: entry.grams,
          displayAmount: entry.display_amount,
          kcal: entry.kcal,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
          fiber: entry.fiber,
        });
      }

      const notes = {};
      for (const note of notesRes.data || []) {
        if (note.note_text) notes[note.meal_id] = note.note_text;
      }
      if (Object.keys(notes).length > 0) data._notes = notes;

      const cmts = {};
      for (const c of commentsRes.data || []) {
        cmts[c.meal_id] = { id: c.id, text: c.comment_text, author: c.author };
      }

      setDayData(data);
      setComments(cmts);
      setLoading(false);
    }

    fetchDay();
    return () => { cancelled = true; };
  }, [clientId, selectedDate]);

  const saveComment = useCallback(async (mealId, text) => {
    if (!dayId) return;

    if (!text.trim()) {
      // Delete comment
      const existing = comments[mealId];
      if (existing) {
        await supabase.from('trainer_comments').delete().eq('id', existing.id);
        setComments((prev) => {
          const next = { ...prev };
          delete next[mealId];
          return next;
        });
      }
      return;
    }

    const { data, error } = await supabase
      .from('trainer_comments')
      .upsert(
        {
          day_id: dayId,
          meal_id: mealId,
          comment_text: text.slice(0, 250),
          author: 'trainer',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'day_id,meal_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving comment:', error);
      return;
    }

    setComments((prev) => ({
      ...prev,
      [mealId]: { id: data.id, text: data.comment_text, author: data.author },
    }));
  }, [dayId, comments]);

  const generateAiComment = useCallback(async (mealId, mealLabel, clientProfile) => {
    if (!dayId) return null;

    // Gather all day entries for context
    const allEntries = Object.entries(dayData)
      .filter(([k]) => !k.startsWith('_'))
      .flatMap(([, entries]) => entries);

    const mealEntries = dayData[mealId] || [];
    if (mealEntries.length === 0) return null;

    const dailyTotals = allEntries.reduce(
      (acc, e) => ({
        kcal: acc.kcal + (e.kcal || 0),
        protein: acc.protein + (e.protein || 0),
        carbs: acc.carbs + (e.carbs || 0),
        fat: acc.fat + (e.fat || 0),
        fiber: acc.fiber + (e.fiber || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    try {
      const { data, error } = await supabase.functions.invoke('generate-comment', {
        body: {
          day_id: dayId,
          meal_id: mealId,
          meal_label: mealLabel,
          meal_entries: mealEntries,
          daily_totals: dailyTotals,
          client_name: clientProfile?.display_name || '',
          client_goals: {
            kcal: clientProfile?.goal_kcal || 2000,
            protein: clientProfile?.goal_protein || 100,
            carbs: clientProfile?.goal_carbs || 220,
            fat: clientProfile?.goal_fat || 80,
            fiber: clientProfile?.goal_fiber || 30,
          },
        },
      });

      if (error) {
        console.error('AI comment error:', error);
        return null;
      }

      if (data?.comment) {
        setComments((prev) => ({
          ...prev,
          [mealId]: { id: data.id, text: data.comment, author: 'ai' },
        }));
        return data.comment;
      }
    } catch (err) {
      console.error('AI comment error:', err);
    }
    return null;
  }, [dayId, dayData]);

  return {
    dayData,
    dayId,
    comments,
    loading,
    saveComment,
    generateAiComment,
  };
}
