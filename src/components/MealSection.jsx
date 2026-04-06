import { useState } from 'react';
import { searchCzechFoods } from '../utils/foodSearch';

function round(val) {
  return Math.round(val * 10) / 10;
}

function findPortions(entryName) {
  const results = searchCzechFoods(entryName);
  const exact = results.find((f) => f.name === entryName);
  return exact?.portions || null;
}

export default function MealSection({ meal, entries, onRemove, onToggleAdd, note, onNoteChange, onUpdateEntry, trainerComment }) {
  const totalKcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
  const [editingNote, setEditingNote] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editUnit, setEditUnit] = useState('g');
  const [editPortions, setEditPortions] = useState(null);

  function startEditAmount(entry) {
    setEditingEntryId(entry.id);
    setEditValue(String(entry.grams));
    setEditUnit('g');
    setEditPortions(findPortions(entry.name));
  }

  function getEditGrams() {
    if (editUnit === 'g') return parseFloat(editValue) || 0;
    if (editUnit.startsWith('portion_') && editPortions) {
      const idx = parseInt(editUnit.split('_')[1]);
      const p = editPortions[idx];
      if (p) return (parseFloat(editValue) || 1) * p.grams;
    }
    return parseFloat(editValue) || 0;
  }

  function commitEdit(entry) {
    const newGrams = getEditGrams();
    if (newGrams > 0 && newGrams !== entry.grams) {
      const factor = newGrams / entry.grams;
      let displayAmount;
      if (editUnit.startsWith('portion_') && editPortions) {
        const idx = parseInt(editUnit.split('_')[1]);
        const p = editPortions[idx];
        const count = parseFloat(editValue) || 1;
        displayAmount = count > 1 ? `${count}× ${p.label} (${Math.round(newGrams)}g)` : `${p.label} (${p.grams}g)`;
      } else {
        displayAmount = `${Math.round(newGrams)}g`;
      }
      onUpdateEntry(entry.id, {
        ...entry,
        grams: Math.round(newGrams),
        displayAmount,
        kcal: round(entry.kcal * factor),
        protein: round(entry.protein * factor),
        carbs: round(entry.carbs * factor),
        fat: round(entry.fat * factor),
        fiber: round((entry.fiber || 0) * factor),
      });
    }
    setEditingEntryId(null);
  }

  function handleUnitChange(newUnit, entry) {
    if (newUnit === 'g') {
      setEditValue(String(entry.grams));
    } else {
      setEditValue('1');
    }
    setEditUnit(newUnit);
  }

  return (
    <div className="meal-section">
      <div className="meal-header">
        <span className="meal-name">{meal.label}</span>
        {entries.length > 0 && (
          <span className="meal-kcal">{Math.round(totalKcal)} kcal</span>
        )}
        <div className="meal-actions">
          <button
            className={`meal-note-btn ${note ? 'has-note' : ''}`}
            onClick={() => setEditingNote(!editingNote)}
            title="Poznámka"
          >
            📝
          </button>
          <button className="meal-add-btn" onClick={onToggleAdd} title="Přidat jídlo">
            <span>+</span>
          </button>
        </div>
      </div>
      {entries.length > 0 && (
        <div className="meal-entries">
          {entries.map((entry) => (
            <div key={entry.id} className="meal-entry">
              <div className="entry-info">
                <span className="entry-name">{entry.name}</span>
                {editingEntryId === entry.id ? (
                  <span className="entry-amount-edit">
                    <input
                      type="number"
                      min="1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(entry);
                        if (e.key === 'Escape') setEditingEntryId(null);
                      }}
                      autoFocus
                    />
                    <select
                      value={editUnit}
                      onChange={(e) => handleUnitChange(e.target.value, entry)}
                      className="entry-unit-select"
                    >
                      <option value="g">g</option>
                      {editPortions && editPortions.map((p, i) => (
                        <option key={i} value={`portion_${i}`}>{p.label} ({p.grams}g)</option>
                      ))}
                    </select>
                    <button className="entry-edit-confirm" onClick={() => commitEdit(entry)}>✓</button>
                  </span>
                ) : (
                  <span
                    className="entry-amount clickable"
                    onClick={() => startEditAmount(entry)}
                    title="Klikni pro úpravu gramáže"
                  >
                    {entry.displayAmount || `${entry.grams}g`}
                  </span>
                )}
              </div>
              <div className="entry-macros">
                <span className="macro-kcal">{entry.kcal} kcal</span>
                <span className="macro-protein">{entry.protein}g B</span>
                <span className="macro-carbs">{entry.carbs}g S</span>
                <span className="macro-fat">{entry.fat}g T</span>
                <span className="macro-fiber">{entry.fiber || 0}g V</span>
              </div>
              <button
                className="entry-remove"
                onClick={() => onRemove(entry.id)}
                title="Odebrat"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {editingNote && (
        <div className="meal-note">
          <textarea
            placeholder="Napište poznámku k tomuto jídlu..."
            value={note || ''}
            onChange={(e) => onNoteChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                setEditingNote(false);
              }
            }}
            rows={2}
            autoFocus
          />
        </div>
      )}
      {note && !editingNote && (
        <div className="meal-note-preview">
          <span onClick={() => setEditingNote(true)}>📝 {note}</span>
          <button
            className="entry-remove"
            onClick={() => onNoteChange('')}
            title="Smazat poznámku"
          >
            ×
          </button>
        </div>
      )}
      {trainerComment && (
        <div className="trainer-comment-client">
          <span className="trainer-comment-client-icon">💬</span>
          <span className="trainer-comment-client-text">{trainerComment}</span>
        </div>
      )}
    </div>
  );
}
