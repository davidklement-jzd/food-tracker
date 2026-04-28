import { useState, useEffect, useCallback } from 'react';
import { useClientList } from '../hooks/useTrainerData';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLast7Days() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(toDateStr(d));
  }
  return days;
}

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - date) / (1000 * 60 * 60 * 24));
  const dayName = date.toLocaleDateString('cs-CZ', { weekday: 'short' });
  const label = `${d}.${m}.`;
  if (diff === 0) return { top: 'Dnes', bottom: label };
  if (diff === 1) return { top: 'Včera', bottom: label };
  return { top: dayName.charAt(0).toUpperCase() + dayName.slice(1), bottom: label };
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

export default function TrainerDashboard({ onSelectClient }) {
  const { user } = useAuth();
  const { clients, loading, refresh } = useClientList();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkResult, setBulkResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedDates, setSelectedDates] = useState(new Set([getLast7Days()[1]])); // default: včera
  const [deleteTarget, setDeleteTarget] = useState(null); // client object pending delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Invite state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteClientName, setInviteClientName] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState(null); // { code, link }
  const [inviteCopied, setInviteCopied] = useState(false);
  const [invites, setInvites] = useState([]);
  const [showInviteList, setShowInviteList] = useState(false);

  const fetchInvites = useCallback(async () => {
    const { data } = await supabase
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setInvites(data);
  }, []);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  async function createInvite() {
    setInviteLoading(true);
    const code = generateInviteCode();
    const { error } = await supabase.from('invite_codes').insert({
      code,
      trainer_id: user.id,
      client_name: inviteClientName.trim(),
    });
    if (error) {
      console.error('Invite insert error:', error);
      setInviteLoading(false);
      return;
    }
    const link = `${window.location.origin}/?invite=${code}`;
    setGeneratedInvite({ code, link });
    setInviteLoading(false);
    fetchInvites();
  }

  function closeInviteModal() {
    setShowInviteModal(false);
    setInviteClientName('');
    setGeneratedInvite(null);
    setInviteCopied(false);
  }

  async function copyInviteLink() {
    if (!generatedInvite) return;
    try {
      await navigator.clipboard.writeText(generatedInvite.link);
    } catch {
      // Fallback for iOS / iframe / insecure context
      const ta = document.createElement('textarea');
      ta.value = generatedInvite.link;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  async function deleteInvite(inviteId) {
    await supabase.from('invite_codes').delete().eq('id', inviteId);
    fetchInvites();
  }

  function openDelete(client, e) {
    e.stopPropagation();
    setDeleteTarget(client);
    setDeleteError(null);
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const { data, error } = await supabase.functions.invoke('delete-client', {
      body: { client_id: deleteTarget.id },
    });
    if (error || data?.error) {
      setDeleteError(error?.message || data?.error || 'Chyba při mazání.');
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setDeleteTarget(null);
    await refresh();
  }

  const last7 = getLast7Days();

  function toggleDate(dateStr) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }

  function toggleSelect(clientId, e) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === clients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(clients.map((c) => c.id)));
    }
  }

  async function commentSelected() {
    if (selectedIds.size === 0 || selectedDates.size === 0) return;
    const clientIds = [...selectedIds];
    const dates = [...selectedDates].sort();
    const total = clientIds.length * dates.length;

    setBulkLoading(true);
    setBulkResult(null);
    setBulkProgress({ current: 0, total });

    let totalGenerated = 0;
    let totalSkipped = 0;
    let done = 0;

    try {
      for (const date of dates) {
        for (const clientId of clientIds) {
          const { data, error } = await supabase.functions.invoke('generate-all-comments', {
            body: { date, client_ids: [clientId] },
          });

          if (error) {
            console.error('Bulk comment error:', error);
            setBulkResult({ error: 'Chyba při generování komentářů.' });
            setBulkLoading(false);
            return;
          }
          totalGenerated += data.generated || 0;
          totalSkipped += data.skipped || 0;
          done++;
          setBulkProgress({ current: done, total });
        }
      }

      setBulkResult({
        success: true,
        generated: totalGenerated,
        skipped: totalSkipped,
      });
    } catch (err) {
      console.error('Bulk comment error:', err);
      setBulkResult({ error: 'Chyba při generování komentářů.' });
    }

    setBulkLoading(false);
  }

  if (loading) {
    return <div className="trainer-loading">Načítání klientek...</div>;
  }

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;

  return (
    <div className="trainer-dashboard">
      <div className="trainer-dashboard-header">
        <h2 className="trainer-title">Klientky ({clients.length})</h2>
        <div className="trainer-header-actions">
          <button
            className="trainer-invite-btn"
            onClick={() => setShowInviteModal(true)}
            title="Pozvat novou klientku"
          >
            + Pozvat
          </button>
          {invites.length > 0 && (
            <button
              className="trainer-invite-list-btn"
              onClick={() => setShowInviteList(!showInviteList)}
            >
              Pozvánky ({invites.filter((i) => !i.used_by).length})
            </button>
          )}
        </div>
      </div>

      {showInviteList && invites.length > 0 && (
        <div className="invite-list">
          {invites.map((inv) => {
            const expired = new Date(inv.expires_at) < new Date();
            const used = !!inv.used_by;
            return (
              <div key={inv.id} className={`invite-list-item ${used ? 'used' : expired ? 'expired' : 'active'}`}>
                <div className="invite-list-info">
                  <span className="invite-list-name">{inv.client_name || inv.code}</span>
                  <span className="invite-list-status">
                    {used ? 'Použitá' : expired ? 'Vypršelá' : 'Čeká'}
                  </span>
                </div>
                {!used && (
                  <button className="invite-list-delete" onClick={() => deleteInvite(inv.id)}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {clients.length > 0 && (
        <>
          <div className="trainer-date-picker">
            <span className="trainer-date-label">Den k okomentování:</span>
            <div className="trainer-date-chips">
              {last7.map((dateStr) => {
                const label = formatDayLabel(dateStr);
                return (
                  <button
                    key={dateStr}
                    className={`trainer-date-chip ${selectedDates.has(dateStr) ? 'active' : ''}`}
                    onClick={() => toggleDate(dateStr)}
                  >
                    <span className="chip-top">{label.top}</span>
                    <span className="chip-bottom">{label.bottom}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="trainer-select-actions">
            <button className="trainer-select-all-btn" onClick={toggleAll}>
              {allSelected ? '✓ Odznačit vše' : '☐ Vybrat vše'}
            </button>
            {selectedIds.size > 0 && selectedDates.size > 0 && (
              <button
                className="trainer-bulk-btn trainer-bulk-btn-all"
                onClick={commentSelected}
                disabled={bulkLoading}
              >
                {bulkLoading
                  ? `⏳ Generuji komentáře... ${bulkProgress.current}/${bulkProgress.total}`
                  : `🤖 Okomentovat vybrané (${selectedIds.size} kl., ${selectedDates.size} ${selectedDates.size === 1 ? 'den' : 'dny'})`}
              </button>
            )}
          </div>
        </>
      )}

      {bulkResult && (
        <div className={`trainer-bulk-result ${bulkResult.error ? 'error' : 'success'}`}>
          {bulkResult.error
            ? bulkResult.error
            : `Vygenerováno ${bulkResult.generated} komentářů, přeskočeno ${bulkResult.skipped} jídel.`}
        </div>
      )}
      {clients.length === 0 ? (
        <div className="trainer-empty">Zatím žádné klientky.</div>
      ) : (
        <div className="trainer-client-list">
          {clients.map((client) => (
            <div
              key={client.id}
              className={`trainer-client-card ${selectedIds.has(client.id) ? 'selected' : ''}`}
              onClick={() => onSelectClient(client)}
            >
              <label
                className="client-checkbox"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(client.id)}
                  onChange={(e) => toggleSelect(client.id, e)}
                />
              </label>
              <div className="client-avatar">
                {(client.display_name || client.email)[0].toUpperCase()}
              </div>
              <div className="client-info">
                <span className="client-name">
                  {client.display_name || 'Bez jména'}
                </span>
                <span className="client-email">{client.email}</span>
              </div>
              <button
                className="client-delete-btn"
                onClick={(e) => openDelete(client, e)}
                title="Smazat klientku"
              >
                🗑
              </button>
              <span className="client-arrow">›</span>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <div className="delete-modal-overlay" onClick={closeDelete}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Smazat klientku</h3>
            <p>
              Opravdu chceš trvale smazat účet <strong>{deleteTarget.display_name || deleteTarget.email}</strong>{' '}
              i veškerá její data? Tato akce je nevratná.
            </p>
            {deleteError && <div className="delete-error">{deleteError}</div>}
            <div className="delete-modal-actions">
              <button className="delete-cancel-btn" onClick={closeDelete} disabled={deleting}>
                Ne
              </button>
              <button
                className="delete-confirm-btn"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Mažu...' : 'Ano, smazat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="delete-modal-overlay" onClick={closeInviteModal}>
          <div className="delete-modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pozvat klientku</h3>
            {!generatedInvite ? (
              <>
                <input
                  type="text"
                  placeholder="Jméno klientky (volitelné)"
                  value={inviteClientName}
                  onChange={(e) => setInviteClientName(e.target.value)}
                  className="auth-input"
                  style={{ marginBottom: 12 }}
                />
                <button
                  className="trainer-bulk-btn trainer-bulk-btn-all"
                  onClick={createInvite}
                  disabled={inviteLoading}
                  style={{ width: '100%' }}
                >
                  {inviteLoading ? 'Vytvářím...' : 'Vytvořit pozvánku'}
                </button>
              </>
            ) : (
              <div className="invite-result">
                <p style={{ marginBottom: 8 }}>Pozvánka vytvořena! Pošli tento odkaz klientce:</p>
                <div className="invite-link-box">
                  <input
                    type="text"
                    value={generatedInvite.link}
                    readOnly
                    className="auth-input"
                    style={{ fontSize: 13, marginBottom: 0 }}
                    onClick={(e) => e.target.select()}
                  />
                </div>
                <button
                  className="trainer-bulk-btn trainer-bulk-btn-all"
                  onClick={copyInviteLink}
                  style={{ width: '100%', marginTop: 10 }}
                >
                  {inviteCopied ? 'Zkopírováno!' : 'Kopírovat odkaz'}
                </button>
                <button
                  className="trainer-select-all-btn"
                  onClick={closeInviteModal}
                  style={{ width: '100%', marginTop: 8 }}
                >
                  Zavřít
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
