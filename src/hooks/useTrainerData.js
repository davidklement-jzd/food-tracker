import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DIARY_ENTRY_SELECT, buildDiaryEntry } from './useSupabaseDiary';

export function useClientList() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'client')
      .order('display_name');

    if (error) {
      console.error('Error fetching clients:', error);
    } else {
      setClients(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { clients, loading, refresh };
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
          .select(DIARY_ENTRY_SELECT)
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
        data[entry.meal_id].push(buildDiaryEntry(entry));
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

  const ensureDayId = useCallback(async () => {
    if (dayId) return dayId;
    const { data } = await supabase
      .from('diary_days')
      .upsert({ user_id: clientId, date: selectedDate }, { onConflict: 'user_id,date' })
      .select('id')
      .single();
    if (data) setDayId(data.id);
    return data?.id;
  }, [dayId, clientId, selectedDate]);

  const addEntry = useCallback(async (mealId, entry) => {
    const id = await ensureDayId();
    if (!id) return;
    const currentEntries = dayData[mealId] || [];
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('diary_entries')
      .insert({
        day_id: id, meal_id: mealId,
        name: entry.name, brand: entry.brand || '',
        grams: entry.grams, display_amount: entry.displayAmount,
        kcal: entry.kcal, protein: entry.protein, carbs: entry.carbs,
        fat: entry.fat, fiber: entry.fiber || 0,
        sort_order: currentEntries.length,
        created_by: currentUser?.id || null,
      })
      .select().single();
    if (!error && data) {
      setDayData((prev) => ({
        ...prev,
        [mealId]: [...(prev[mealId] || []), {
          id: data.id, name: data.name, brand: data.brand,
          grams: data.grams, displayAmount: data.display_amount,
          kcal: data.kcal, protein: data.protein, carbs: data.carbs,
          fat: data.fat, fiber: data.fiber,
          created_by: data.created_by,
        }],
      }));
    }
  }, [ensureDayId, dayData]);

  const removeEntry = useCallback(async (mealId, entryId) => {
    await supabase.from('diary_entries').delete().eq('id', entryId);
    setDayData((prev) => ({
      ...prev,
      [mealId]: (prev[mealId] || []).filter((e) => e.id !== entryId),
    }));
  }, []);

  const updateEntry = useCallback(async (mealId, entryId, updated) => {
    await supabase.from('diary_entries').update({
      grams: updated.grams, display_amount: updated.displayAmount,
      kcal: updated.kcal, protein: updated.protein, carbs: updated.carbs,
      fat: updated.fat, fiber: updated.fiber || 0,
    }).eq('id', entryId);
    setDayData((prev) => ({
      ...prev,
      [mealId]: (prev[mealId] || []).map((e) => e.id === entryId ? { ...e, ...updated } : e),
    }));
  }, []);

  const updateNote = useCallback(async (mealId, text) => {
    const id = await ensureDayId();
    if (!id) return;
    if (text) {
      await supabase.from('meal_notes').upsert(
        { day_id: id, meal_id: mealId, note_text: text, updated_at: new Date().toISOString() },
        { onConflict: 'day_id,meal_id' }
      );
    } else {
      await supabase.from('meal_notes').delete().eq('day_id', id).eq('meal_id', mealId);
    }
    setDayData((prev) => {
      const notes = { ...(prev._notes || {}), [mealId]: text };
      if (!text) delete notes[mealId];
      return { ...prev, _notes: Object.keys(notes).length > 0 ? notes : undefined };
    });
  }, [ensureDayId]);

  return {
    dayData,
    dayId,
    comments,
    loading,
    saveComment,
    generateAiComment,
    addEntry,
    removeEntry,
    updateEntry,
    updateNote,
  };
}
