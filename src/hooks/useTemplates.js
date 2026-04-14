import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useTemplates(userId) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('meal_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (data) setTemplates(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  async function saveTemplate(name, entries) {
    const items = entries.map((e) => ({
      name: e.name,
      brand: e.brand || '',
      food_id: e.food_id || null,
      grams: e.grams,
      unit: e.unit || 'g',
      display_amount: e.displayAmount || e.display_amount || `${e.grams}${e.unit || 'g'}`,
      kcal: e.kcal || 0,
      protein: e.protein || 0,
      carbs: e.carbs || 0,
      fat: e.fat || 0,
      fiber: e.fiber || 0,
    }));
    const totalKcal = items.reduce((s, i) => s + i.kcal, 0);
    const { error } = await supabase.from('meal_templates').insert({
      user_id: userId,
      name,
      items,
      total_kcal: Math.round(totalKcal),
    });
    if (!error) await fetch();
    return { error };
  }

  async function deleteTemplate(id) {
    await supabase.from('meal_templates').delete().eq('id', id);
    await fetch();
  }

  return { templates, loading, saveTemplate, deleteTemplate, refresh: fetch };
}
