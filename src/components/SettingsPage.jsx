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
  const [targetWeight, setTargetWeight] = useState(profile?.target_weight ?? '');
  const [height, setHeight] = useState(profile?.height ?? '');
  const [age, setAge] = useState(profile?.age ?? '');
  const [goals, setGoals] = useState(() =>
    Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, profile?.[f.key] ?? f.default]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [largeText, setLargeText] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('large_text') === '1'
  );

  function toggleLargeText(next) {
    setLargeText(next);
    if (next) {
      localStorage.setItem('large_text', '1');
      document.body.classList.add('large-text');
    } else {
      localStorage.removeItem('large_text');
      document.body.classList.remove('large-text');
    }
  }

  function handleGoalChange(key, value) {
    setGoals((prev) => ({ ...prev, [key]: value === '' ? '' : Number(value) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const newInitialWeight = initialWeight === '' ? null : Number(initialWeight);
    const wasInitialWeightEmpty = profile?.initial_weight == null;
    const updates = {
      display_name: displayName.trim(),
      initial_weight: newInitialWeight,
      target_weight: targetWeight === '' ? null : Number(targetWeight),
      height: height === '' ? null : Number(height),
      age: age === '' ? null : Number(age),
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

    // First-time initial weight: also create today's weight entry so it shows in the chart
    if (!error && wasInitialWeightEmpty && newInitialWeight != null) {
      const userId = isEditingOther ? targetUserId : ownProfile?.id;
      if (userId) {
        const today = new Date().toISOString().split('T')[0];
        await supabase.from('weight_entries').upsert(
          { user_id: userId, weight: newInitialWeight, date: today },
          { onConflict: 'user_id,date' }
        );
      }
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
              <label htmlFor="displayName">Jméno a příjmení</label>
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
            <div className="settings-field">
              <label htmlFor="targetWeight">Cílová váha</label>
              <div className="settings-input-with-unit">
                <input
                  id="targetWeight"
                  type="number"
                  min="0"
                  step="0.1"
                  style={{ width: '70px' }}
                  value={targetWeight}
                  onChange={(e) => setTargetWeight(e.target.value === '' ? '' : e.target.value)}
                />
                <span className="settings-unit">kg</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="height">Výška</label>
              <div className="settings-input-with-unit">
                <input
                  id="height"
                  type="number"
                  min="0"
                  step="0.1"
                  style={{ width: '70px' }}
                  value={height}
                  onChange={(e) => setHeight(e.target.value === '' ? '' : e.target.value)}
                />
                <span className="settings-unit">cm</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="age">Věk</label>
              <div className="settings-input-with-unit">
                <input
                  id="age"
                  type="number"
                  min="0"
                  step="1"
                  style={{ width: '70px' }}
                  value={age}
                  onChange={(e) => setAge(e.target.value === '' ? '' : e.target.value)}
                />
                <span className="settings-unit">let</span>
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

          {!isEditingOther && (
            <div className="settings-section">
              <h3>Vzhled</h3>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={largeText}
                  onChange={(e) => toggleLargeText(e.target.checked)}
                />
                <span>Větší písmo</span>
              </label>
            </div>
          )}

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
