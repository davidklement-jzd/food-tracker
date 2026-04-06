import { useState, useRef, useEffect } from 'react';
import { searchActivities } from '../data/activities';

function round(n) {
  return Math.round(n);
}

export default function ActivitySearchModal({ onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(searchActivities(''));
  const [selected, setSelected] = useState(null);
  const [duration, setDuration] = useState('30');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    setResults(searchActivities(query));
  }, [query]);

  const previewKcal = selected
    ? round((selected.kcal_per_hour / 60) * (parseFloat(duration) || 0))
    : 0;

  function handleSelect(activity) {
    setSelected(activity);
    setDuration('30');
  }

  function handleAdd() {
    if (!selected) return;
    const mins = parseInt(duration) || 0;
    if (mins <= 0) return;
    onAdd({
      name: selected.name,
      duration: mins,
      kcal_burned: round((selected.kcal_per_hour / 60) * mins),
    });
    onClose();
  }

  function handleBack() {
    setSelected(null);
    setQuery('');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Přidat aktivitu</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!selected ? (
          <>
            <div className="modal-search">
              <span className="modal-search-icon">🔍</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="hledat aktivitu ..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="modal-results">
              {results.map((activity) => (
                <div
                  key={activity.id}
                  className="modal-result-item"
                  onClick={() => handleSelect(activity)}
                >
                  <span className="modal-result-name">{activity.name}</span>
                  <span className="modal-result-kcal">
                    ~{activity.kcal_per_hour} kcal/hod
                  </span>
                </div>
              ))}
              {query.trim().length >= 2 && results.length === 0 && (
                <div className="modal-no-results">Nic nenalezeno</div>
              )}
            </div>
          </>
        ) : (
          <div className="modal-detail">
            <div className="modal-detail-name">{selected.name}</div>
            <div className="modal-detail-kcal">
              ~{selected.kcal_per_hour} kcal / hodinu
            </div>

            <div className="modal-amount-label">Délka</div>
            <div className="modal-amount-row">
              <input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="modal-amount-input"
                autoFocus
              />
              <span className="modal-amount-unit-text">minut</span>
            </div>

            <div className="modal-preview">
              <div className="modal-preview-total">
                <strong>-{previewKcal} kcal</strong>
              </div>
            </div>

            <div className="modal-detail-actions">
              <button className="modal-btn-back" onClick={handleBack}>
                ← Zpět
              </button>
              <button className="modal-btn-add" onClick={handleAdd}>
                Přidat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
