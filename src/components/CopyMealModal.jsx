import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const MEALS = [
  { id: 'breakfast', label: 'Snídaně' },
  { id: 'snack1', label: 'Dopolední svačina' },
  { id: 'lunch', label: 'Oběd' },
  { id: 'snack2', label: 'Odpolední svačina' },
  { id: 'dinner', label: 'Večeře' },
];

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - date) / (1000 * 60 * 60 * 24));
  const dayName = date.toLocaleDateString('cs-CZ', { weekday: 'short' });
  const label = `${d}.${m}.`;
  if (diff === 0) return { top: 'Dnes', bottom: label };
  if (diff === 1) return { top: 'Včera', bottom: label };
  return { top: dayName.charAt(0).toUpperCase() + dayName.slice(1), bottom: label };
}

function getLast7Days(excludeDate) {
  const days = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = toDateStr(d);
    if (ds !== excludeDate) days.push(ds);
  }
  return days.slice(0, 7);
}

export default function CopyMealModal({ userId, currentDate, targetMealId, onCopy, onClose }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayEntries, setDayEntries] = useState(null); // { mealId: [entries] }
  const [loading, setLoading] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState(null);

  const days = getLast7Days(currentDate);

  // Auto-select yesterday
  useEffect(() => {
    if (days.length > 0 && !selectedDate) {
      setSelectedDate(days[0]);
    }
  }, []);

  // Fetch entries when date changes
  useEffect(() => {
    if (!selectedDate || !userId) return;
    setLoading(true);
    setSelectedMeal(null);

    async function fetchEntries() {
      const { data: dayRow } = await supabase
        .from('diary_days')
        .select('id')
        .eq('user_id', userId)
        .eq('date', selectedDate)
        .single();

      if (!dayRow) {
        setDayEntries({});
        setLoading(false);
        return;
      }

      const { data: entries } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('day_id', dayRow.id)
        .order('sort_order', { ascending: true });

      const grouped = {};
      for (const e of (entries || [])) {
        if (!grouped[e.meal_id]) grouped[e.meal_id] = [];
        grouped[e.meal_id].push(e);
      }
      setDayEntries(grouped);
      setLoading(false);
    }
    fetchEntries();
  }, [selectedDate, userId]);

  function handleCopy() {
    if (!selectedMeal || !dayEntries[selectedMeal]) return;
    const entries = dayEntries[selectedMeal].map((e) => ({
      id: Date.now() + Math.random(),
      name: e.name,
      brand: e.brand || '',
      grams: e.grams,
      displayAmount: e.display_amount || `${e.grams}${e.unit || 'g'}`,
      kcal: e.kcal,
      protein: e.protein,
      carbs: e.carbs,
      fat: e.fat,
      fiber: e.fiber || 0,
      food_id: e.food_id || null,
      unit: e.unit || 'g',
      portions: null,
    }));
    onCopy(entries);
    onClose();
  }

  const mealsWithEntries = MEALS.filter((m) => dayEntries && dayEntries[m.id]?.length > 0);
  const previewEntries = selectedMeal && dayEntries ? (dayEntries[selectedMeal] || []) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="copy-meal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="copy-meal-header">
          <h3>Kopírovat jídlo</h3>
          <button className="copy-meal-close" onClick={onClose}>×</button>
        </div>

        {/* Date picker */}
        <div className="copy-meal-dates">
          {days.map((ds) => {
            const label = formatDayLabel(ds);
            return (
              <button
                key={ds}
                className={`copy-date-chip ${selectedDate === ds ? 'active' : ''}`}
                onClick={() => setSelectedDate(ds)}
              >
                <span className="chip-top">{label.top}</span>
                <span className="chip-bottom">{label.bottom}</span>
              </button>
            );
          })}
        </div>

        {/* Meal picker */}
        {loading ? (
          <div className="copy-meal-loading">Načítání...</div>
        ) : mealsWithEntries.length === 0 ? (
          <div className="copy-meal-empty">Tento den nemá žádné záznamy.</div>
        ) : (
          <div className="copy-meal-list">
            {mealsWithEntries.map((meal) => {
              const entries = dayEntries[meal.id];
              const totalKcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
              const isSelected = selectedMeal === meal.id;
              return (
                <button
                  key={meal.id}
                  className={`copy-meal-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedMeal(isSelected ? null : meal.id)}
                >
                  <span className="copy-meal-name">{meal.label}</span>
                  <span className="copy-meal-meta">{entries.length} položek · {Math.round(totalKcal)} kcal</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Preview */}
        {selectedMeal && previewEntries.length > 0 && (
          <div className="copy-meal-preview">
            {previewEntries.map((e, i) => (
              <div key={i} className="copy-preview-item">
                <span className="copy-preview-name">{e.name}</span>
                <span className="copy-preview-amount">{e.display_amount || `${e.grams}${e.unit || 'g'}`}</span>
                <span className="copy-preview-kcal">{Math.round(e.kcal)} kcal</span>
              </div>
            ))}
          </div>
        )}

        {/* Copy button */}
        {selectedMeal && previewEntries.length > 0 && (
          <button className="copy-meal-confirm" onClick={handleCopy}>
            Zkopírovat {previewEntries.length} položek
          </button>
        )}
      </div>
    </div>
  );
}
