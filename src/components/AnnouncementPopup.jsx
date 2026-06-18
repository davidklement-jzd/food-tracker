import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Vyskakovací okno se zprávami od trenéra.
// Zpráva se klientce zobrazí ve třech situacích:
//  1) při otevření / restartu aplikace (počáteční načtení),
//  2) živě, když má appku v popředí (realtime odběr),
//  3) při návratu z pozadí na plochu zpět do appky (re-fetch na visibility),
//     protože uspaný websocket mohl zprávu mezitím zmeškat.
// Tlačítkem „Rozumím" je klientka odklikne (dismissed_at) a okno zmizí.
export default function AnnouncementPopup({ userId }) {
  const [items, setItems] = useState([]); // [{ announcement_id, body, created_at }]
  const [dismissing, setDismissing] = useState(false);

  const fetchUnread = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('announcement_recipients')
      .select('announcement_id, announcements(body, created_at)')
      .eq('user_id', userId)
      .is('dismissed_at', null);
    if (error || !data) return;
    const rows = data
      .map((r) => ({
        announcement_id: r.announcement_id,
        body: r.announcements?.body || '',
        created_at: r.announcements?.created_at || '',
      }))
      .filter((x) => x.body)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    setItems(rows);
  }, [userId]);

  // 1) Načtení při otevření / restartu aplikace.
  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  // 3) Návrat z pozadí do popředí: websocket mohl mezitím vypadnout a zprávu
  // zmeškat, takže při návratu do appky znovu dotáhneme nepřečtené.
  useEffect(() => {
    if (!userId) return;
    const onForeground = () => {
      if (document.visibilityState === 'visible') fetchUnread();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [userId, fetchUnread]);

  // 2) Živý odběr (appka v popředí): nová zpráva naskočí okamžitě.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`announcements_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'announcement_recipients',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const annId = payload.new?.announcement_id;
          if (!annId) return;
          const { data, error } = await supabase
            .from('announcements')
            .select('body, created_at')
            .eq('id', annId)
            .single();
          if (error || !data?.body) return;
          setItems((prev) => {
            if (prev.some((x) => x.announcement_id === annId)) return prev;
            return [
              ...prev,
              { announcement_id: annId, body: data.body, created_at: data.created_at || '' },
            ].sort((a, b) => a.created_at.localeCompare(b.created_at));
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
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
          <h3>{items.length > 1 ? 'Zprávy od Davida' : 'Zpráva od Davida'}</h3>
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
