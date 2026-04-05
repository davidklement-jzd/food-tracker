import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSupabaseDiary } from './hooks/useSupabaseDiary';
import AuthPage from './components/AuthPage';
import SearchBar from './components/SearchBar';
import DailySummary from './components/DailySummary';
import MealSection from './components/MealSection';
import FoodSearchModal from './components/FoodSearchModal';
import TrainerDashboard from './components/TrainerDashboard';
import TrainerClientDiary from './components/TrainerClientDiary';
import './App.css';

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

export default function App() {
  const { user, profile, loading: authLoading, signOut, isTrainer } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [modalMeal, setModalMeal] = useState(null);
  const [trainerView, setTrainerView] = useState('dashboard'); // 'dashboard' | 'client'
  const [selectedClient, setSelectedClient] = useState(null);

  const {
    dayData,
    comments,
    loading: diaryLoading,
    addEntry,
    removeEntry,
    updateEntry,
    updateNote,
  } = useSupabaseDiary(user?.id, selectedDate);

  if (authLoading) {
    return (
      <div className="app-loading">
        <img src="/icon-192.png" alt="Logo" className="loading-logo" />
        <p>Načítání...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  function getAllEntries() {
    return MEALS.flatMap((m) => dayData[m.id] || []);
  }

  function changeDate(offset) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + offset);
    setSelectedDate(toDateStr(date));
  }

  const modalMealObj = MEALS.find((m) => m.id === modalMeal);

  // Trainer view
  if (isTrainer && trainerView !== 'myDiary') {
    return (
      <div className="app">
        <header className="app-header">
          <div className="logo">
            <img src="/icon-192.png" alt="Logo" className="logo-icon-img" />
            <span className="logo-text">Jak na zdravé tělo</span>
          </div>
          <div className="header-nav-tabs">
            <button
              className={`nav-tab ${trainerView !== 'myDiary' ? 'active' : ''}`}
              onClick={() => { setTrainerView('dashboard'); setSelectedClient(null); }}
            >
              Klientky
            </button>
            <button
              className={`nav-tab ${trainerView === 'myDiary' ? 'active' : ''}`}
              onClick={() => setTrainerView('myDiary')}
            >
              Můj jídelníček
            </button>
          </div>
          <div className="header-user">
            <span className="user-name">{profile?.display_name || user.email}</span>
            <button className="sign-out-btn" onClick={signOut} title="Odhlásit se">
              Odhlásit
            </button>
          </div>
        </header>

        <div className="main-layout">
          <main className="content">
            {trainerView === 'client' && selectedClient ? (
              <TrainerClientDiary
                client={selectedClient}
                onBack={() => { setTrainerView('dashboard'); setSelectedClient(null); }}
              />
            ) : (
              <TrainerDashboard
                onSelectClient={(client) => {
                  setSelectedClient(client);
                  setTrainerView('client');
                }}
              />
            )}
          </main>
        </div>
      </div>
    );
  }

  // Client view (or trainer's own diary)
  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <img src="/icon-192.png" alt="Logo" className="logo-icon-img" />
          <span className="logo-text">Jak na zdravé tělo</span>
        </div>
        {isTrainer ? (
          <div className="header-nav-tabs">
            <button
              className="nav-tab"
              onClick={() => setTrainerView('dashboard')}
            >
              Klientky
            </button>
            <button className="nav-tab active">
              Můj jídelníček
            </button>
          </div>
        ) : (
          <SearchBar
            onAdd={(entry) => {
              addEntry('breakfast', entry);
            }}
          />
        )}
        <div className="header-user">
          <span className="user-name">{profile?.display_name || user.email}</span>
          <button className="sign-out-btn" onClick={signOut} title="Odhlásit se">
            Odhlásit
          </button>
        </div>
      </header>

      <div className="main-layout">
        <main className="content">
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

          <div className="diary-content">
            <div className="diary-meals">
              <div className="intake-label">
                🍴 Příjem {Math.round(getAllEntries().reduce((s, e) => s + (e.kcal || 0), 0))} kcal
                {diaryLoading && <span className="diary-loading"> ...</span>}
              </div>
              {MEALS.map((meal) => (
                <MealSection
                  key={meal.id}
                  meal={meal}
                  entries={dayData[meal.id] || []}
                  onRemove={(entryId) => removeEntry(meal.id, entryId)}
                  onUpdateEntry={(entryId, updated) => updateEntry(meal.id, entryId, updated)}
                  onToggleAdd={() => setModalMeal(meal.id)}
                  note={(dayData._notes || {})[meal.id] || ''}
                  onNoteChange={(text) => updateNote(meal.id, text)}
                  trainerComment={comments[meal.id]}
                />
              ))}
            </div>

            <DailySummary entries={getAllEntries()} profile={profile} />
          </div>
        </main>
      </div>

      {modalMeal && modalMealObj && (
        <FoodSearchModal
          mealLabel={modalMealObj.label}
          onAdd={(entry) => addEntry(modalMeal, entry)}
          onClose={() => setModalMeal(null)}
        />
      )}
    </div>
  );
}
