import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Vyskakovací okno se zprávami od trenéra. Při otevření aplikace načte
// nepřečtené zprávy klientky a zobrazí je. Tlačítkem „Rozumím" je klientka
// odklikne (nastaví dismissed_at) a okno zmizí. Dokud neodklikne, naskočí
// jí to při každém otevření.
export default function AnnouncementPopup({ userId }) {
  const [items, setItems] = useState([]); // [{ announcement_id, body }]
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('announcement_recipients')
        .select('announcement_id, announcements(body, created_at)')
        .eq('user_id', userId)
        .is('dismissed_at', null);
      if (cancelled || error || !data) return;
      const rows = data
        .map((r) => ({
          announcement_id: r.announcement_id,
          body: r.announcements?.body || '',
          created_at: r.announcements?.created_at || '',
        }))
        .filter((x) => x.body)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      setItems(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dismissAll = useCallback(async () => {
    if (items.length === 0) return;
    setDismissing(true);
    const ids = items.map((x) => x.announcement_id);
    const { error } = await supabase
      .from('announcement_recipients')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('announcement_id', ids);
    if (error) {
      console.error('Dismiss announcement error:', error);
      setDismissing(false);
      return;
    }
    setItems([]);
    setDismissing(false);
  }, [items, userId]);

  if (items.length === 0) return null;

  return (
    <div className="modal-overlay">
      <div className="announcement-modal" onClick={(e) => e.stopPropagation()}>
        <div className="announcement-header">
          <span className="announcement-icon">💬</span>
          <h3>{items.length > 1 ? 'Zprávy od trenéra' : 'Zpráva od trenéra'}</h3>
        </div>
        <div className="announcement-body">
          {items.map((x) => (
            <p key={x.announcement_id} className="announcement-text">
              {x.body}
            </p>
          ))}
        </div>
        <button
          className="announcement-ok-btn"
          onClick={dismissAll}
          disabled={dismissing}
        >
          {dismissing ? '...' : 'Rozumím'}
        </button>
      </div>
    </div>
  );
}
