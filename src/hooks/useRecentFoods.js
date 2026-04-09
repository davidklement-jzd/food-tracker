import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Vrací klientčiny nedávno použité potraviny přes RPC get_recent_foods.
// Parametry:
//   mealId        — volitelný filtr na sekci jídla (breakfast/lunch/…). null = napříč
//   days          — okno v dnech (default 30)
//   limit         — max počet položek (default 20)
//   enabled       — když false, hook nevolá RPC (used pro 'supplements' / Kalorický dluh)
//   targetUserId  — když není null, vrací nedávné potraviny zadané klientky
//                   (trenér edituje její deník). RPC interně ověří, že volající je trenér.
export function useRecentFoods({ mealId = null, days = 30, limit = 20, enabled = true, targetUserId = null } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecent = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_recent_foods', {
      p_meal_id: mealId,
      p_days: days,
      p_limit: limit,
      p_target_user_id: targetUserId,
    });
    if (error) {
      console.error('get_recent_foods error:', error);
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }, [enabled, mealId, days, limit, targetUserId]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  return { items, loading, refetch: fetchRecent };
}
