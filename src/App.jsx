import { useState, useEffect, useRef } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSupabaseDiary } from './hooks/useSupabaseDiary';
import AuthPage from './components/AuthPage';
import SearchBar from './components/SearchBar';
import DailySummary from './components/DailySummary';
import MealSection from './components/MealSection';
import FoodSearchModal from './components/FoodSearchModal';
import TrainerDashboard from './components/TrainerDashboard';
import TrainerClientDiary from './components/TrainerClientDiary';
import SettingsPage from './components/SettingsPage';
import AnalysisPage from './components/AnalysisPage';
import WeightTracker from './components/WeightTracker';
import ActivitySection from './components/ActivitySection';
import ActivitySearchModal from './components/ActivitySearchModal';
import { useActivityDiary } from './hooks/useActivityDiary';
import './App.css';

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

export default function App() {
  const { user, profile, loading: authLoading, signOut, isTrainer } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [modalMeal, setModalMeal] = useState(null);
  const [trainerView, setTrainerView] = useState('dashboard'); // 'dashboard' | 'client'
  const [selectedClient, setSelectedClient] = useState(null);
  const [currentView, setCurrentView] = useState('diary'); // 'diary' | 'settings'
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!showUserMenu) return;
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const {
    dayData,
    comments,
    loading: diaryLoading,
    addEntry,
    removeEntry,
    updateEntry,
    updateNote,
  } = useSupabaseDiary(user?.id, selectedDate);

  const {
    activities,
    addActivity,
    removeActivity,
    updateActivity,
  } = useActivityDiary(user?.id, selectedDate);

  const [activityModal, setActivityModal] = useState(false);

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
            <button className="header-action-btn" onClick={() => setCurrentView('analysis')}>
              Analýza
            </button>
            <button className="header-action-btn" onClick={() => setCurrentView('settings')}>
              Nastavení
            </button>
            <div className="user-menu-wrapper" ref={userMenuRef}>
              <button className="user-name-btn" onClick={() => setShowUserMenu((v) => !v)}>
                {profile?.display_name || user.email}
              </button>
              {showUserMenu && (
                <div className="user-menu">
                  <button onClick={() => { signOut(); setShowUserMenu(false); }}>
                    Odhlásit se
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {currentView === 'settings' ? (
          <SettingsPage onBack={() => setCurrentView('diary')} />
        ) : currentView === 'analysis' ? (
          <AnalysisPage onBack={() => setCurrentView('diary')} />
        ) : (
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
        )}
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
          <button className="header-action-btn" onClick={() => setCurrentView('analysis')}>
            Analýza
          </button>
          <button className="header-action-btn" onClick={() => setCurrentView('settings')}>
            Nastavení
          </button>
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <button className="user-name-btn" onClick={() => setShowUserMenu((v) => !v)}>
              {profile?.display_name || user.email}
            </button>
            {showUserMenu && (
              <div className="user-menu">
                <button onClick={() => { signOut(); setShowUserMenu(false); }}>
                  Odhlásit se
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {currentView === 'settings' ? (
        <SettingsPage onBack={() => setCurrentView('diary')} />
      ) : currentView === 'analysis' ? (
        <AnalysisPage onBack={() => setCurrentView('diary')} />
      ) : (
      <>
      <div className="main-layout">
        <main className="content">
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

          <div className="intake-label">
            🍴 Příjem {Math.round(getAllEntries().reduce((s, e) => s + (e.kcal || 0), 0))} kcal
            {diaryLoading && <span className="diary-loading"> ...</span>}
          </div>

          <div className="diary-content">
            <div className="diary-meals">
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
                  ownerId={user?.id}
                />
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
              <DailySummary entries={getAllEntries()} profile={profile} />
              <WeightTracker userId={user.id} profile={profile} selectedDate={selectedDate} />
            </div>
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
      {activityModal && (
        <ActivitySearchModal
          onAdd={addActivity}
          onClose={() => setActivityModal(false)}
        />
      )}
      </>
      )}
    </div>
  );
}
