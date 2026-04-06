import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const GOAL_FIELDS = [
  { key: 'goal_kcal', label: 'Kalorický cíl', unit: 'kcal', default: 2000 },
  { key: 'goal_protein', label: 'Bílkoviny', unit: 'g', default: 100 },
  { key: 'goal_carbs', label: 'Sacharidy', unit: 'g', default: 220 },
  { key: 'goal_fat', label: 'Tuky', unit: 'g', default: 80 },
  { key: 'goal_fiber', label: 'Vláknina', unit: 'g', default: 30 },
];

export default function SettingsPage({ onBack, targetUserId, targetProfile, onProfileUpdate }) {
  const { profile: ownProfile, updateProfile } = useAuth();

  // If editing another user (trainer editing client), use targetProfile
  const isEditingOther = !!targetUserId;
  const profile = isEditingOther ? targetProfile : ownProfile;

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [initialWeight, setInitialWeight] = useState(profile?.initial_weight ?? '');
  const [goals, setGoals] = useState(() =>
    Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, profile?.[f.key] ?? f.default]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  function handleGoalChange(key, value) {
    setGoals((prev) => ({ ...prev, [key]: value === '' ? '' : Number(value) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const updates = {
      display_name: displayName.trim(),
      initial_weight: initialWeight === '' ? null : Number(initialWeight),
    };
    for (const f of GOAL_FIELDS) {
      updates[f.key] = goals[f.key] === '' ? f.default : Number(goals[f.key]);
    }

    let error;
    if (isEditingOther) {
      // Trainer editing client profile directly
      const res = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', targetUserId)
        .select()
        .single();
      error = res.error;
      if (!res.error && res.data && onProfileUpdate) {
        onProfileUpdate(res.data);
      }
      // Also log goal_kcal change to history
      if (!res.error && updates.goal_kcal != null) {
        const today = new Date().toISOString().split('T')[0];
        await supabase.from('goal_history').upsert(
          { user_id: targetUserId, goal_kcal: updates.goal_kcal, date: today },
          { onConflict: 'user_id,date' }
        );
      }
    } else {
      const res = await updateProfile(updates);
      error = res.error;
    }

    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: 'Chyba při ukládání: ' + error.message });
    } else {
      setMessage({ type: 'success', text: 'Nastavení uloženo!' });
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <button className="settings-back-btn" onClick={onBack}>
            ← Zpět
          </button>
          <h2>{isEditingOther ? `Nastavení – ${profile?.display_name || ''}` : 'Nastavení'}</h2>
        </div>

        <form onSubmit={handleSave}>
          <div className="settings-section">
            <h3>Profil</h3>
            <div className="settings-field">
              <label htmlFor="displayName">Jméno</label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="initialWeight">Počáteční váha</label>
              <div className="settings-input-with-unit">
                <input
                  id="initialWeight"
                  type="number"
                  min="0"
                  step="0.1"
                  style={{ width: '70px' }}
                  value={initialWeight}
                  onChange={(e) => setInitialWeight(e.target.value === '' ? '' : e.target.value)}
                />
                <span className="settings-unit">kg</span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Denní cíle</h3>
            {GOAL_FIELDS.map((f) => (
              <div className="settings-field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <div className="settings-input-with-unit">
                  <input
                    id={f.key}
                    type="number"
                    min="0"
                    value={goals[f.key]}
                    onChange={(e) => handleGoalChange(f.key, e.target.value)}
                  />
                  <span className="settings-unit">{f.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {message && (
            <div className={`settings-message ${message.type}`}>
              {message.text}
            </div>
          )}

          <button type="submit" className="settings-save-btn" disabled={saving}>
            {saving ? 'Ukládám...' : 'Uložit'}
          </button>
        </form>
      </div>
    </div>
  );
}
