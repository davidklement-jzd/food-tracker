import { useState, useRef, useEffect } from 'react';
import { useWeightTracker } from '../hooks/useWeightTracker';

export default function WeightTracker({ userId, profile, selectedDate }) {
  const { weightForDate, loading, saveWeight } = useWeightTracker(userId, selectedDate);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const displayWeight = weightForDate?.weight ?? profile?.initial_weight ?? null;
  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleClick() {
    if (!isToday) return;
    setInputValue(displayWeight != null ? String(displayWeight) : '');
    setEditing(true);
  }

  async function handleSave() {
    const val = parseFloat(inputValue);
    if (isNaN(val) || val <= 0) return;
    setSaving(true);
    await saveWeight(val);
    setSaving(false);
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  }

  if (loading) return null;

  return (
    <div className="weight-tracker">
      <div className="weight-tracker-label">Váha</div>
      <div className="weight-tracker-value-row">
        {editing ? (
          <div className="weight-edit">
            <input
              ref={inputRef}
              type="number"
              step="0.1"
              min="0"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="weight-edit-input"
              disabled={saving}
            />
            <span className="weight-unit">kg</span>
          </div>
        ) : (
          <button
            className={`weight-display ${!isToday ? 'readonly' : ''}`}
            onClick={handleClick}
            title={isToday ? 'Klikni pro úpravu' : 'Váhu lze zapsat pouze pro dnešní den'}
          >
            <span className="weight-number">
              {displayWeight != null ? displayWeight : '–'}
            </span>
            <span className="weight-unit">kg</span>
          </button>
        )}
      </div>
      {weightForDate?.date && (
        <div className="weight-date">
          Zápis: {new Date(weightForDate.date + 'T00:00:00').toLocaleDateString('cs-CZ')}
        </div>
      )}
    </div>
  );
}
