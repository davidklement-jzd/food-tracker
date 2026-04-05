import { useState } from 'react';

function round(val) {
  return Math.round(val * 10) / 10;
}

export default function MealSection({ meal, entries, onRemove, isActive, onToggleAdd, note, onNoteChange, onUpdateEntry }) {
  const totalKcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
  const [editingNote, setEditingNote] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editGrams, setEditGrams] = useState('');

  function startEditAmount(entry) {
    setEditingEntryId(entry.id);
    setEditGrams(String(entry.grams));
  }

  function commitEdit(entry) {
    const newGrams = parseFloat(editGrams);
    if (newGrams > 0 && newGrams !== entry.grams) {
      const factor = newGrams / entry.grams;
      onUpdateEntry(entry.id, {
        ...entry,
        grams: Math.round(newGrams),
        displayAmount: `${Math.round(newGrams)}g`,
        kcal: round(entry.kcal * factor),
        protein: round(entry.protein * factor),
        carbs: round(entry.carbs * factor),
        fat: round(entry.fat * factor),
      });
    }
    setEditingEntryId(null);
  }

  return (
    <div className={`meal-section ${isActive ? 'meal-active' : ''}`}>
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
          <button className={`meal-add-btn ${isActive ? 'active' : ''}`} onClick={onToggleAdd} title="Přidat jídlo">
            <span>{isActive ? '✓' : '+'}</span>
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
                      value={editGrams}
                      onChange={(e) => setEditGrams(e.target.value)}
                      onBlur={() => commitEdit(entry)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(entry);
                        if (e.key === 'Escape') setEditingEntryId(null);
                      }}
                      autoFocus
                    />
                    <span>g</span>
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
    </div>
  );
}
