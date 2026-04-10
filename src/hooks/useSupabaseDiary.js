import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Heuristika pro legacy zápisy bez food_id — když nelze odvodit z foods.is_liquid,
// zkusíme detekovat tekutinu podle názvu, ať starší entries dostanou ml + porce.
const LIQUID_NAME_RE = /\b(ml[ée]ko|voda|pivo|birel|radler|le[žz][áa]k|kef[íi]r|smoothie|d[žz]us|n[áa]poj|kakao|[čc]aj|k[áa]va|limon[áa]da|cola|coca|cider|v[íi]no|[šs][ťt][áa]va|koktejl|drink|mo[šs]t|kombucha|latte|cappuccino|espresso|sirup|protein\s*shake|shake)\b/i;

const DEFAULT_LIQUID_PORTIONS = [
  { label: 'Sklenice (250 ml)', grams: 250 },
  { label: 'Plechovka (330 ml)', grams: 330 },
  { label: 'Půllitr (500 ml)', grams: 500 },
  { label: 'Litr (1000 ml)', grams: 1000 },
];

export function isLikelyLiquid(name) {
  return LIQUID_NAME_RE.test(name || '');
}

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
          .select('*, food:foods(is_liquid, portions)')
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
        // Odvození unit: foods.is_liquid > heuristika podle názvu/značky > uložený sloupec.
        // Heuristika smí přebít stored 'g' u zjevných tekutin (legacy zápisy + foods, kde
        // is_liquid není správně nastaveno — viz Birel).
        const liquidByName =
          isLikelyLiquid(entry.name) || isLikelyLiquid(entry.brand);
        const derivedUnit = entry.food?.is_liquid
          ? 'ml'
          : liquidByName
          ? 'ml'
          : entry.unit || 'g';
        const derivedPortions =
          (Array.isArray(entry.food?.portions) && entry.food.portions.length > 0
            ? entry.food.portions
            : null) ||
          (derivedUnit === 'ml' ? DEFAULT_LIQUID_PORTIONS : null);
        // Stale display_amount: pokud máme ml, ale uloženo je "Ng", regeneruj.
        let displayAmount = entry.display_amount;
        if (
          displayAmount &&
          derivedUnit === 'ml' &&
          /^\d+(?:[.,]\d+)?\s*g$/i.test(displayAmount.trim())
        ) {
          displayAmount = `${entry.grams}ml`;
        }
        data[entry.meal_id].push({
          id: entry.id,
          name: entry.name,
          brand: entry.brand,
          grams: entry.grams,
          displayAmount,
          kcal: entry.kcal,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
          fiber: entry.fiber,
          unit: derivedUnit,
          food_id: entry.food_id || null,
          portions: derivedPortions,
          created_by: entry.created_by,
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

    const { data: { user: currentUser } } = await supabase.auth.getUser();
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
        created_by: currentUser?.id || null,
        food_id: entry.food_id || null,
        unit: entry.unit || 'g',
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
      unit: data.unit || entry.unit || 'g',
      food_id: data.food_id || null,
      portions: entry.portions || null,
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
