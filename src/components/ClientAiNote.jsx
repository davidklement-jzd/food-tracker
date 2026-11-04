import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Stejný strop jako CHECK v migraci 032 a CLIENT_AI_NOTE_MAX_LEN v edge funkcích.
const MAX_LENGTH = 2000;

function formatUpdated(iso) {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

// Trvalá poznámka trenéra ke klientce pro AI komentování. Klientka ji nevidí:
// komponenta se renderuje jen v trenérském deníku a tabulku jí nepustí RLS.
export default function ClientAiNote({ clientId }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [note, setNote] = useState(null); // { text, updatedAt } | null
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('client_ai_notes')
        .select('note_text, updated_at')
        .eq('client_id', clientId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Client AI note load error:', error);
        setStatus('error');
        return;
      }
      setNote(data ? { text: data.note_text, updatedAt: data.updated_at } : null);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, reloadKey]);

  function startEditing() {
    setDraft(note?.text || '');
    setSaveError('');
    setEditing(true);
  }

  // Editor se zavře až po úspěšném uložení, ať se napsaný text při chybě neztratí.
  // Prázdný text poznámku smaže.
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    const text = draft.trim();
    let error;
    let saved = null;
    if (text) {
      const res = await supabase
        .from('client_ai_notes')
        .upsert(
          { client_id: clientId, note_text: text, updated_at: new Date().toISOString() },
          { onConflict: 'client_id' },
        )
        .select('note_text, updated_at')
        .single();
      error = res.error;
      if (res.data) saved = { text: res.data.note_text, updatedAt: res.data.updated_at };
    } else {
      ({ error } = await supabase.from('client_ai_notes').delete().eq('client_id', clientId));
    }
    setSaving(false);
    if (error) {
      console.error('Client AI note save error:', error);
      setSaveError('Uložení se nepovedlo, zkuste to znovu.');
      return;
    }
    setNote(saved);
    setEditing(false);
  }

  if (status === 'loading') return null;

  // Při chybě načtení nenabízíme editor: prázdné pole by mohlo přepsat
  // existující poznámku, a trenér by si myslel, že žádná není.
  if (status === 'error') {
    return (
      <div className="client-ai-note">
        <div className="client-ai-note-head">
          <span>🔒 Poznámku pro AI se nepodařilo načíst</span>
          <button
            className="client-ai-note-link"
            onClick={() => {
              setStatus('loading');
              setReloadKey((k) => k + 1);
            }}
          >
            Zkusit znovu
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="client-ai-note">
        <div className="client-ai-note-head">
          <span>🔒 Poznámka pro AI · klientka ji nevidí</span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_LENGTH}
          rows={4}
          placeholder="Např.: Neřešit bílkoviny u snídaně, řeší s lékařem. Nezmiňovat váhu."
          lang="cs"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
          autoFocus
        />
        {saveError && <div className="trainer-comment-error">{saveError}</div>}
        <div className="trainer-comment-footer">
          <span className="trainer-comment-chars">
            {draft.length}/{MAX_LENGTH}
          </span>
          <div className="trainer-comment-actions">
            <button className="trainer-comment-cancel" onClick={() => setEditing(false)} disabled={saving}>
              Zrušit
            </button>
            <button className="trainer-comment-save" onClick={handleSave} disabled={saving}>
              {saving ? 'Ukládám...' : 'Uložit'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <button className="client-ai-note-add" onClick={startEditing}>
        🔒 Přidat poznámku pro AI (klientka ji nevidí)
      </button>
    );
  }

  return (
    <div className="client-ai-note">
      <div className="client-ai-note-head">
        <span>🔒 Poznámka pro AI · klientka ji nevidí</span>
        <button className="client-ai-note-link" onClick={startEditing}>
          Upravit
        </button>
      </div>
      <div className="client-ai-note-text">{note.text}</div>
      <div className="client-ai-note-meta">Upraveno {formatUpdated(note.updatedAt)}</div>
    </div>
  );
}
