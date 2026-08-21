import { useState } from 'react';

export default function TrainerComment({ mealId, mealLabel, comment, hasEntries, onSave, onGenerateAi }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment?.text || '');
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Editor se zavře až po ÚSPĚŠNÉM uložení. Když zápis selže (vypršelý token,
  // výpadek), zůstane otevřený i s napsaným textem, ať o něj David nepřijde.
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    const res = await onSave(text.trim());
    setSaving(false);
    if (res?.error) {
      setSaveError('Uložení se nepovedlo, zkuste to znovu.');
      return;
    }
    setEditing(false);
  }

  async function handleDelete() {
    const res = await onSave('');
    if (res?.error) setSaveError('Smazání se nepovedlo, zkuste to znovu.');
  }

  function handleCancel() {
    setText(comment?.text || '');
    setSaveError('');
    setEditing(false);
  }

  async function handleAi() {
    setAiLoading(true);
    const result = await onGenerateAi();
    if (result) {
      setText(result);
      setEditing(true);
    }
    setAiLoading(false);
  }

  if (editing) {
    return (
      <div className="trainer-comment editing">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 250))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="Napište komentář... (Enter uloží, Shift+Enter nový řádek)"
          rows={2}
          autoFocus
          maxLength={250}
          lang="cs"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
        />
        {saveError && <div className="trainer-comment-error">{saveError}</div>}
        <div className="trainer-comment-footer">
          <span className="trainer-comment-chars">{text.length}/250</span>
          <div className="trainer-comment-actions">
            <button className="trainer-comment-cancel" onClick={handleCancel} disabled={saving}>
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

  if (comment) {
    return (
      <div className={`trainer-comment has-comment ${comment.author === 'ai' ? 'ai-authored' : ''}`}>
        <div className="trainer-comment-bubble">
          <span className="trainer-comment-icon">
            {comment.author === 'ai' ? '🤖' : '💬'}
          </span>
          <span className="trainer-comment-text">{comment.text}</span>
        </div>
        <div className="trainer-comment-actions">
          <button className="trainer-comment-edit" onClick={() => { setText(comment.text); setSaveError(''); setEditing(true); }}>
            Upravit
          </button>
          <button className="trainer-comment-delete" onClick={handleDelete}>
            Smazat
          </button>
        </div>
        {saveError && <div className="trainer-comment-error">{saveError}</div>}
      </div>
    );
  }

  if (!hasEntries) return null;

  return (
    <div className="trainer-comment empty">
      <button className="trainer-comment-write" onClick={() => { setText(''); setEditing(true); }}>
        💬 Komentovat
      </button>
      {onGenerateAi && (
        <button
          className="trainer-comment-ai"
          onClick={handleAi}
          disabled={aiLoading}
        >
          {aiLoading ? '⏳ Generuji...' : '🤖 AI komentář'}
        </button>
      )}
    </div>
  );
}
