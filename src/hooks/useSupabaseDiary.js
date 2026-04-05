import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useSupabaseDiary(userId, selectedDate) {
  const [dayData, setDayData] = useState({});
  const [dayId, setDayId] = useState(null);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch day data whenever date or user changes
  useEffect(() => {
    if (!userId || !selectedDate) {
      setDayData({});
      setDayId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchDay() {
      setLoading(true);

      // Get or find the diary_day row
      const { data: dayRow } = await supabase
        .from('diary_days')
        .select('id')
        .eq('user_id', userId)
        .eq('date', selectedDate)
        .single();

      if (cancelled) return;

      if (!dayRow) {
        setDayData({});
        setDayId(null);
        setLoading(false);
        return;
      }

      setDayId(dayRow.id);

      // Fetch entries, notes, and trainer comments in parallel
      const [entriesRes, notesRes, commentsRes] = await Promise.all([
        supabase
          .from('diary_entries')
          .select('*')
          .eq('day_id', dayRow.id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('meal_notes')
          .select('*')
          .eq('day_id', dayRow.id),
        supabase
          .from('trainer_comments')
          .select('meal_id, comment_text')
          .eq('day_id', dayRow.id),
      ]);

      if (cancelled) return;

      // Build dayData in the same format as localStorage
      const data = {};
      const entries = entriesRes.data || [];
      for (const entry of entries) {
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

      // Notes
      const notes = {};
      for (const note of notesRes.data || []) {
        if (note.note_text) notes[note.meal_id] = note.note_text;
      }
      if (Object.keys(notes).length > 0) {
        data._notes = notes;
      }

      // Trainer comments (shown anonymously to client)
      const cmts = {};
      for (const c of commentsRes.data || []) {
        if (c.comment_text) cmts[c.meal_id] = c.comment_text;
      }
      setComments(cmts);

      setDayData(data);
      setLoading(false);
    }

    fetchDay();
    return () => { cancelled = true; };
  }, [userId, selectedDate]);

  // Ensure a diary_day row exists, return its id
  const ensureDayId = useCallback(async () => {
    if (dayId) return dayId;

    const { data, error } = await supabase
      .from('diary_days')
      .upsert({ user_id: userId, date: selectedDate }, { onConflict: 'user_id,date' })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating diary day:', error);
      return null;
    }

    setDayId(data.id);
    return data.id;
  }, [dayId, userId, selectedDate]);

  const addEntry = useCallback(async (mealId, entry) => {
    const id = await ensureDayId();
    if (!id) return;

    const currentEntries = dayData[mealId] || [];

    const { data, error } = await supabase
      .from('diary_entries')
      .insert({
        day_id: id,
        meal_id: mealId,
        name: entry.name,
        brand: entry.brand || '',
        grams: entry.grams,
        display_amount: entry.displayAmount,
        kcal: entry.kcal,
        protein: entry.protein,
        carbs: entry.carbs,
        fat: entry.fat,
        fiber: entry.fiber || 0,
        sort_order: currentEntries.length,
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding entry:', error);
      return;
    }

    const newEntry = {
      id: data.id,
      name: data.name,
      brand: data.brand,
      grams: data.grams,
      displayAmount: data.display_amount,
      kcal: data.kcal,
      protein: data.protein,
      carbs: data.carbs,
      fat: data.fat,
      fiber: data.fiber,
    };

    setDayData((prev) => ({
      ...prev,
      [mealId]: [...(prev[mealId] || []), newEntry],
    }));
  }, [ensureDayId, dayData]);

  const removeEntry = useCallback(async (mealId, entryId) => {
    const { error } = await supabase
      .from('diary_entries')
      .delete()
      .eq('id', entryId);

    if (error) {
      console.error('Error removing entry:', error);
      return;
    }

    setDayData((prev) => ({
      ...prev,
      [mealId]: (prev[mealId] || []).filter((e) => e.id !== entryId),
    }));
  }, []);

  const updateEntry = useCallback(async (mealId, entryId, updatedEntry) => {
    const { error } = await supabase
      .from('diary_entries')
      .update({
        grams: updatedEntry.grams,
        display_amount: updatedEntry.displayAmount,
        kcal: updatedEntry.kcal,
        protein: updatedEntry.protein,
        carbs: updatedEntry.carbs,
        fat: updatedEntry.fat,
        fiber: updatedEntry.fiber || 0,
      })
      .eq('id', entryId);

    if (error) {
      console.error('Error updating entry:', error);
      return;
    }

    setDayData((prev) => ({
      ...prev,
      [mealId]: (prev[mealId] || []).map((e) =>
        e.id === entryId ? { ...e, ...updatedEntry } : e
      ),
    }));
  }, []);

  const updateNote = useCallback(async (mealId, text) => {
    const id = await ensureDayId();
    if (!id) return;

    if (text) {
      await supabase
        .from('meal_notes')
        .upsert(
          { day_id: id, meal_id: mealId, note_text: text, updated_at: new Date().toISOString() },
          { onConflict: 'day_id,meal_id' }
        );
    } else {
      await supabase
        .from('meal_notes')
        .delete()
        .eq('day_id', id)
        .eq('meal_id', mealId);
    }

    setDayData((prev) => {
      const notes = { ...(prev._notes || {}), [mealId]: text };
      if (!text) delete notes[mealId];
      return { ...prev, _notes: Object.keys(notes).length > 0 ? notes : undefined };
    });
  }, [ensureDayId]);

  return {
    dayData,
    comments,
    loading,
    addEntry,
    removeEntry,
    updateEntry,
    updateNote,
  };
}
