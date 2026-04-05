import { useState, useCallback } from 'react';
import { useClientDiary } from '../hooks/useTrainerData';
import DailySummary from './DailySummary';
import TrainerComment from './TrainerComment';

const MEALS = [
  { id: 'breakfast', label: 'Snídaně' },
  { id: 'snack1', label: 'Dopolední svačina' },
  { id: 'lunch', label: 'Oběd' },
  { id: 'snack2', label: 'Odpolední svačina' },
  { id: 'dinner', label: 'Večeře' },
  { id: 'supplements', label: 'Přepisy' },
];

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.toLocaleDateString('cs-CZ', { weekday: 'long' });
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' })}`;
}

function round(val) {
  return Math.round(val * 10) / 10;
}

export default function TrainerClientDiary({ client, onBack }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [bulkLoading, setBulkLoading] = useState(false);
  const {
    dayData,
    comments,
    loading,
    saveComment,
    generateAiComment,
  } = useClientDiary(client.id, selectedDate);

  function changeDate(offset) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + offset);
    setSelectedDate(toDateStr(date));
  }

  function getAllEntries() {
    return MEALS.flatMap((m) => dayData[m.id] || []);
  }

  const commentWholeDay = useCallback(async () => {
    setBulkLoading(true);
    const mealsWithEntries = MEALS.filter((m) => (dayData[m.id] || []).length > 0 && !comments[m.id]);
    for (const meal of mealsWithEntries) {
      await generateAiComment(meal.id, meal.label, client);
    }
    setBulkLoading(false);
  }, [dayData, comments, generateAiComment, client]);

  return (
    <div className="trainer-client-diary">
      <div className="trainer-client-header">
        <button className="trainer-back-btn" onClick={onBack}>
          ← Zpět
        </button>
        <div className="trainer-client-name">
          {client.display_name || client.email}
        </div>
      </div>

      <div className="date-nav">
        <button onClick={() => changeDate(-1)} className="date-btn">
          ‹ Předchozí
        </button>
        <div className="date-current">
          <span>{formatDate(selectedDate)}</span>
          {selectedDate !== todayStr() && (
            <button onClick={() => setSelectedDate(todayStr())} className="today-btn">
              Dnes
            </button>
          )}
        </div>
        <button onClick={() => changeDate(1)} className="date-btn">
          Další ›
        </button>
      </div>

      {!loading && getAllEntries().length > 0 && (
        <div className="trainer-bulk-actions">
          <button
            className="trainer-bulk-btn"
            onClick={commentWholeDay}
            disabled={bulkLoading}
          >
            {bulkLoading ? '⏳ Generuji komentáře...' : '🤖 Okomentovat celý den'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="trainer-loading">Načítání...</div>
      ) : (
        <div className="diary-content">
          <div className="diary-meals">
            <div className="intake-label">
              🍴 Příjem {Math.round(getAllEntries().reduce((s, e) => s + (e.kcal || 0), 0))} kcal
            </div>
            {MEALS.map((meal) => {
              const entries = dayData[meal.id] || [];
              const comment = comments[meal.id];
              const note = (dayData._notes || {})[meal.id];
              const totalKcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);

              return (
                <div key={meal.id} className="meal-section">
                  <div className="meal-header">
                    <span className="meal-name">{meal.label}</span>
                    {entries.length > 0 && (
                      <span className="meal-kcal">{Math.round(totalKcal)} kcal</span>
                    )}
                  </div>

                  {entries.length > 0 && (
                    <div className="meal-entries">
                      {entries.map((entry) => (
                        <div key={entry.id} className="meal-entry">
                          <div className="entry-info">
                            <span className="entry-name">{entry.name}</span>
                            <span className="entry-amount">
                              {entry.displayAmount || `${entry.grams}g`}
                            </span>
                          </div>
                          <div className="entry-macros">
                            <span className="macro-kcal">{entry.kcal} kcal</span>
                            <span className="macro-protein">{round(entry.protein)}g B</span>
                            <span className="macro-carbs">{round(entry.carbs)}g S</span>
                            <span className="macro-fat">{round(entry.fat)}g T</span>
                            <span className="macro-fiber">{round(entry.fiber || 0)}g V</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {note && (
                    <div className="meal-note-preview">
                      <span>📝 {note}</span>
                    </div>
                  )}

                  <TrainerComment
                    mealId={meal.id}
                    mealLabel={meal.label}
                    comment={comment}
                    hasEntries={entries.length > 0}
                    onSave={(text) => saveComment(meal.id, text)}
                    onGenerateAi={() => generateAiComment(meal.id, meal.label, client)}
                  />
                </div>
              );
            })}
          </div>

          <DailySummary entries={getAllEntries()} profile={client} />
        </div>
      )}
    </div>
  );
}
