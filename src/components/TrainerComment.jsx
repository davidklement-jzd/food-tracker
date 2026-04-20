import { useState } from 'react';

export default function TrainerComment({ mealId, mealLabel, comment, hasEntries, onSave, onGenerateAi }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment?.text || '');
  const [aiLoading, setAiLoading] = useState(false);

  function handleSave() {
    onSave(text.trim());
    setEditing(false);
  }

  function handleCancel() {
    setText(comment?.text || '');
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
          placeholder="Napište komentář..."
          rows={2}
          autoFocus
          maxLength={250}
          lang="cs"
          autoCorrect="off"
          autoCapitalize="sentences"
        />
        <div className="trainer-comment-footer">
          <span className="trainer-comment-chars">{text.length}/250</span>
          <div className="trainer-comment-actions">
            <button className="trainer-comment-cancel" onClick={handleCancel}>
              Zrušit
            </button>
            <button className="trainer-comment-save" onClick={handleSave}>
              Uložit
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
          <button className="trainer-comment-edit" onClick={() => { setText(comment.text); setEditing(true); }}>
            Upravit
          </button>
          <button className="trainer-comment-delete" onClick={() => onSave('')}>
            Smazat
          </button>
        </div>
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
