import { useState, useCallback } from 'react';
import { useClientDiary } from '../hooks/useTrainerData';
import { useActivityDiary } from '../hooks/useActivityDiary';
import DailySummary from './DailySummary';
import MealSection from './MealSection';
import FoodSearchModal from './FoodSearchModal';
import ActivitySection from './ActivitySection';
import ActivitySearchModal from './ActivitySearchModal';
import WeightTracker from './WeightTracker';
import SettingsPage from './SettingsPage';
import AnalysisPage from './AnalysisPage';
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

export default function TrainerClientDiary({ client, onBack }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [modalMeal, setModalMeal] = useState(null);
  const [activityModal, setActivityModal] = useState(false);
  const [clientView, setClientView] = useState('diary'); // 'diary' | 'settings' | 'analysis'
  const [clientProfile, setClientProfile] = useState(client);

  const {
    dayData,
    comments,
    loading,
    saveComment,
    generateAiComment,
    addEntry,
    removeEntry,
    updateEntry,
    updateNote,
  } = useClientDiary(clientProfile.id, selectedDate);

  const {
    activities,
    addActivity,
    removeActivity,
    updateActivity,
  } = useActivityDiary(clientProfile.id, selectedDate);

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
      await generateAiComment(meal.id, meal.label, clientProfile);
    }
    setBulkLoading(false);
  }, [dayData, comments, generateAiComment, clientProfile]);

  const modalMealObj = MEALS.find((m) => m.id === modalMeal);

  // Settings view for this client
  if (clientView === 'settings') {
    return (
      <div className="trainer-client-diary">
        <SettingsPage
          onBack={() => setClientView('diary')}
          targetUserId={clientProfile.id}
          targetProfile={clientProfile}
          onProfileUpdate={(updated) => setClientProfile(updated)}
        />
      </div>
    );
  }

  // Analysis view for this client
  if (clientView === 'analysis') {
    return (
      <div className="trainer-client-diary">
        <AnalysisPage
          onBack={() => setClientView('diary')}
          targetUserId={clientProfile.id}
          targetProfile={clientProfile}
        />
      </div>
    );
  }

  return (
    <div className="trainer-client-diary">
      <div className="trainer-client-header">
        <button className="trainer-back-btn" onClick={onBack}>
          ← Zpět
        </button>
        <div className="trainer-client-name">
          {clientProfile.display_name || clientProfile.email}
        </div>
        <div className="trainer-client-actions">
          <button className="header-action-btn" onClick={() => setClientView('analysis')}>
            Analýza
          </button>
          <button className="header-action-btn" onClick={() => setClientView('settings')}>
            Nastavení
          </button>
        </div>
      </div>

      <div className="date-nav">
        <button onClick={() => changeDate(-1)} className="date-btn">
          ←
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
          →
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
        <>
          <div className="intake-label">
            🍴 Příjem {Math.round(getAllEntries().reduce((s, e) => s + (e.kcal || 0), 0))} kcal
          </div>
          <div className="diary-content">
            <div className="diary-meals">
              {MEALS.map((meal) => (
                <div key={meal.id}>
                  <MealSection
                    meal={meal}
                    entries={dayData[meal.id] || []}
                    onRemove={(entryId) => removeEntry(meal.id, entryId)}
                    onUpdateEntry={(entryId, updated) => updateEntry(meal.id, entryId, updated)}
                    onToggleAdd={() => setModalMeal(meal.id)}
                    note={(dayData._notes || {})[meal.id] || ''}
                    onNoteChange={(text) => updateNote(meal.id, text)}
                    ownerId={clientProfile.id}
                  />
                  <TrainerComment
                    mealId={meal.id}
                    mealLabel={meal.label}
                    comment={comments[meal.id]}
                    hasEntries={(dayData[meal.id] || []).length > 0}
                    onSave={(text) => saveComment(meal.id, text)}
                    onGenerateAi={() => generateAiComment(meal.id, meal.label, clientProfile)}
                  />
                </div>
              ))}

              <div className="activity-label">
                🏃 Aktivity -{Math.round((activities || []).reduce((s, a) => s + (a.kcal_burned || 0), 0))} kcal
              </div>
              <ActivitySection
                activities={activities || []}
                onRemove={removeActivity}
                onUpdate={updateActivity}
                onToggleAdd={() => setActivityModal(true)}
                note={(dayData._notes || {})['activities'] || ''}
                onNoteChange={(text) => updateNote('activities', text)}
              />
            </div>

            <div className="sidebar">
              <DailySummary entries={getAllEntries()} profile={clientProfile} />
              <WeightTracker userId={clientProfile.id} profile={clientProfile} selectedDate={selectedDate} />
            </div>
          </div>
        </>
      )}

      {modalMeal && modalMealObj && (
        <FoodSearchModal
          mealLabel={modalMealObj.label}
          onAdd={(entry) => addEntry(modalMeal, entry)}
          onClose={() => setModalMeal(null)}
        />
      )}
      {activityModal && (
        <ActivitySearchModal
          onAdd={addActivity}
          onClose={() => setActivityModal(false)}
        />
      )}
    </div>
  );
}
