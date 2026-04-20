import { useState } from 'react';
import ACTIVITIES_DB from '../data/activities';

function findKcalPerHour(name) {
  const match = ACTIVITIES_DB.find((a) => a.name === name);
  return match?.kcal_per_hour || null;
}

export default function ActivitySection({ activities, onRemove, onUpdate, onToggleAdd, note, onNoteChange }) {
  const [editingId, setEditingId] = useState(null);
  const [editMinutes, setEditMinutes] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  function openNoteEdit() {
    setNoteDraft(note || '');
    setEditingNote(true);
  }

  function saveNoteAndClose() {
    if ((noteDraft || '') !== (note || '')) onNoteChange(noteDraft);
    setEditingNote(false);
  }

  function startEdit(activity) {
    setEditingId(activity.id);
    setEditMinutes(String(activity.duration));
  }

  function commitEdit(activity) {
    const newMinutes = parseInt(editMinutes);
    if (newMinutes > 0 && newMinutes !== activity.duration) {
      const kcalPerHour = findKcalPerHour(activity.name);
      const newKcal = kcalPerHour
        ? Math.round((kcalPerHour / 60) * newMinutes)
        : Math.round((activity.kcal_burned / activity.duration) * newMinutes);
      onUpdate(activity.id, { duration: newMinutes, kcal_burned: newKcal });
    }
    setEditingId(null);
  }

  return (
    <div className="meal-section activity-section">
      <div className="meal-header">
        <span className="meal-name">Aktivity</span>
        {activities.length > 0 && (
          <span className="meal-kcal">
            -{Math.round(activities.reduce((s, a) => s + (a.kcal_burned || 0), 0))} kcal
          </span>
        )}
        <div className="meal-actions">
          <button
            className={`meal-note-btn ${note ? 'has-note' : ''}`}
            onClick={() => editingNote ? saveNoteAndClose() : openNoteEdit()}
            title="Poznámka"
          >
            📝
          </button>
          <button className="meal-add-btn" onClick={onToggleAdd} title="Přidat aktivitu">
            <span>+</span>
          </button>
        </div>
      </div>

      {activities.length > 0 && (
        <div className="meal-entries">
          {activities.map((activity) => (
            <div key={activity.id} className="meal-entry">
              <div className="entry-info">
                <span className="entry-name">{activity.name}</span>
                {editingId === activity.id ? (
                  <span className="entry-amount-edit">
                    <input
                      type="number"
                      min="1"
                      value={editMinutes}
                      onChange={(e) => setEditMinutes(e.target.value)}
                      onBlur={() => commitEdit(activity)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(activity);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                    />
                    <span>min</span>
                    <button className="entry-edit-confirm" onClick={() => commitEdit(activity)}>✓</button>
                  </span>
                ) : (
                  <span
                    className="entry-amount clickable"
                    onClick={() => startEdit(activity)}
                    title="Klikni pro úpravu"
                  >
                    {activity.duration} min
                  </span>
                )}
              </div>
              <div className="entry-macros">
                <span className="macro-kcal">-{Math.round(activity.kcal_burned)} kcal</span>
              </div>
              <button
                className="entry-remove"
                onClick={() => onRemove(activity.id)}
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
            placeholder="Napište poznámku k aktivitám..."
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNoteAndClose}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveNoteAndClose();
              }
            }}
            rows={2}
            autoFocus
            lang="cs"
            autoCorrect="off"
            autoCapitalize="sentences"
          />
        </div>
      )}
      {note && !editingNote && (
        <div className="meal-note-preview">
          <span onClick={openNoteEdit}>📝 {note}</span>
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
