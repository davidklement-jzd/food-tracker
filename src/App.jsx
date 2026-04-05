import { useState, useRef } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import SearchBar from './components/SearchBar';
import DailySummary from './components/DailySummary';
import MealSection from './components/MealSection';
import './App.css';

const MEALS = [
  { id: 'breakfast', label: 'Snídaně' },
  { id: 'snack1', label: 'Dopolední svačina' },
  { id: 'lunch', label: 'Oběd' },
  { id: 'snack2', label: 'Odpolední svačina' },
  { id: 'dinner', label: 'Večeře' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00');
  const day = d.toLocaleDateString('cs-CZ', { weekday: 'long' });
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${d.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' })}.`;
}

export default function App() {
  const [diary, setDiary] = useLocalStorage('food-tracker-diary', {});
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [addingTo, setAddingTo] = useState(null);
  const searchRef = useRef(null);

  const dayData = diary[selectedDate] || {};

  function getAllEntries() {
    return MEALS.flatMap((m) => dayData[m.id] || []);
  }

  function addEntry(mealId, entry) {
    setDiary((prev) => {
      const day = prev[selectedDate] || {};
      const mealEntries = day[mealId] || [];
      return {
        ...prev,
        [selectedDate]: { ...day, [mealId]: [...mealEntries, entry] },
      };
    });
  }

  function removeEntry(mealId, entryId) {
    setDiary((prev) => {
      const day = prev[selectedDate] || {};
      const mealEntries = (day[mealId] || []).filter((e) => e.id !== entryId);
      return {
        ...prev,
        [selectedDate]: { ...day, [mealId]: mealEntries },
      };
    });
  }

  function updateEntry(mealId, entryId, updatedEntry) {
    setDiary((prev) => {
      const day = prev[selectedDate] || {};
      const mealEntries = (day[mealId] || []).map((e) =>
        e.id === entryId ? updatedEntry : e
      );
      return {
        ...prev,
        [selectedDate]: { ...day, [mealId]: mealEntries },
      };
    });
  }

  function updateNote(mealId, text) {
    setDiary((prev) => {
      const day = prev[selectedDate] || {};
      const notes = day._notes || {};
      return {
        ...prev,
        [selectedDate]: { ...day, _notes: { ...notes, [mealId]: text } },
      };
    });
  }

  function changeDate(offset) {
    const d = new Date(selectedDate + 'T00:00');
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

  function handleToggleAdd(mealId) {
    if (addingTo === mealId) {
      setAddingTo(null);
    } else {
      setAddingTo(mealId);
      // Focus the search input
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">🍽</span>
          <span className="logo-text">FoodTracker</span>
        </div>
        <SearchBar
          ref={searchRef}
          targetMeal={addingTo}
          meals={MEALS}
          onMealChange={setAddingTo}
          onAdd={(entry) => {
            const mealId = addingTo || 'breakfast';
            addEntry(mealId, entry);
          }}
        />
        <nav className="header-nav">
          <a href="#" className="nav-pill active">Jídelníček</a>
          <a href="#" className="nav-pill">Potraviny</a>
        </nav>
      </header>

      <div className="main-layout">
        <main className="content">
          <div className="date-nav">
            <button onClick={() => changeDate(-1)} className="date-btn">
              ‹ Předchozí
            </button>
            <div className="date-current">
              <span className="date-icon">📅</span>
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
              </div>
              {MEALS.map((meal) => (
                <MealSection
                  key={meal.id}
                  meal={meal}
                  entries={dayData[meal.id] || []}
                  onRemove={(entryId) => removeEntry(meal.id, entryId)}
                  onUpdateEntry={(entryId, updated) => updateEntry(meal.id, entryId, updated)}
                  isActive={addingTo === meal.id}
                  onToggleAdd={() => handleToggleAdd(meal.id)}
                  note={(dayData._notes || {})[meal.id] || ''}
                  onNoteChange={(text) => updateNote(meal.id, text)}
                />
              ))}
            </div>

            <DailySummary entries={getAllEntries()} />
          </div>
        </main>
      </div>
    </div>
  );
}
