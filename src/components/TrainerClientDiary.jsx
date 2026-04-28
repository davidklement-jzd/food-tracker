import { useState, useCallback } from 'react';
import { useClientDiary } from '../hooks/useTrainerData';
import { useActivityDiary } from '../hooks/useActivityDiary';
import { useTemplates } from '../hooks/useTemplates';
import { useAuth } from '../contexts/AuthContext';
import DailySummary from './DailySummary';
import MealSection from './MealSection';
import FoodSearchModal from './FoodSearchModal';
import CopyMealModal from './CopyMealModal';
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
  { id: 'supplements', label: 'Kalorický dluh' },
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
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [modalMeal, setModalMeal] = useState(null);
  const [activityModal, setActivityModal] = useState(false);
  const [clientView, setClientView] = useState('diary'); // 'diary' | 'settings' | 'analysis'
  const [clientProfile, setClientProfile] = useState(client);
  const [copyMealModal, setCopyMealModal] = useState(null);
  const [saveTemplateData, setSaveTemplateData] = useState(null);
  const { user } = useAuth();
  const { templates, saveTemplate, deleteTemplate } = useTemplates(user?.id);

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
    // Kalorický dluh (supplements) je účetní úprava, ne jídlo – AI ho nekomentuje.
    const mealsWithEntries = MEALS.filter(
      (m) => m.id !== 'supplements' && (dayData[m.id] || []).length > 0 && !comments[m.id],
    );
    setBulkLoading(true);
    setBulkProgress({ current: 0, total: mealsWithEntries.length });
    let done = 0;
    for (const meal of mealsWithEntries) {
      await generateAiComment(meal.id, meal.label, clientProfile);
      done++;
      setBulkProgress({ current: done, total: mealsWithEntries.length });
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
            {bulkLoading
              ? `⏳ Generuji komentáře... ${bulkProgress.current}/${bulkProgress.total}`
              : '🤖 Okomentovat celý den'}
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
                    onCopyMeal={() => setCopyMealModal(meal.id)}
                    onSaveTemplate={(meal, entries) => setSaveTemplateData({ meal, entries })}
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
                    onGenerateAi={
                      meal.id === 'supplements'
                        ? null
                        : () => generateAiComment(meal.id, meal.label, clientProfile)
                    }
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
          mealId={modalMeal}
          targetUserId={clientProfile.id}
          onAdd={(entry) => addEntry(modalMeal, entry)}
          onClose={() => setModalMeal(null)}
          templates={templates}
          onDeleteTemplate={deleteTemplate}
        />
      )}
      {activityModal && (
        <ActivitySearchModal
          onAdd={addActivity}
          onClose={() => setActivityModal(false)}
        />
      )}
      {copyMealModal && (
        <CopyMealModal
          userId={clientProfile.id}
          currentDate={selectedDate}
          targetMealId={copyMealModal}
          onCopy={(entries) => {
            for (const entry of entries) {
              addEntry(copyMealModal, entry);
            }
          }}
          onClose={() => setCopyMealModal(null)}
        />
      )}
      {saveTemplateData && (
        <div className="modal-overlay" onClick={() => setSaveTemplateData(null)}>
          <div className="copy-meal-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="copy-meal-header">
              <h3>Uložit šablonu</h3>
              <button className="copy-meal-close" onClick={() => setSaveTemplateData(null)}>×</button>
            </div>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
              {saveTemplateData.entries.length} položek z {saveTemplateData.meal.label}
            </p>
            <input
              type="text"
              placeholder="Název šablony (např. Ranní kaše)"
              className="auth-input"
              id="template-name-input-trainer"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  await saveTemplate(e.target.value.trim(), saveTemplateData.entries);
                  setSaveTemplateData(null);
                }
              }}
            />
            <button
              className="copy-meal-confirm"
              style={{ marginTop: 10 }}
              onClick={async () => {
                const input = document.getElementById('template-name-input-trainer');
                if (input?.value.trim()) {
                  await saveTemplate(input.value.trim(), saveTemplateData.entries);
                  setSaveTemplateData(null);
                }
              }}
            >
              Uložit šablonu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
