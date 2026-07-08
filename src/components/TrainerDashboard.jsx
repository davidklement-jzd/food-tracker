import { useState, useEffect, useCallback } from 'react';
import { useClientList, setClientStatus } from '../hooks/useTrainerData';
import { getGoalForDate } from '../hooks/useGoalHistory';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Barvy kalorického kruhu (musí sedět s DailySummary).
const KCAL_COLORS = { red: '#e53935', green: '#43a047', orange: '#fb8c00' };

function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d}.${m}.`;
}

// Po hromadném okomentování spočítá přehled za každou (klientka × den):
// barvu kalorií (oranžová/zelená/červená jako kruh v deníku), zda klientka
// ten den zapsala váhu a zda má textovou poznámku. Vše dávkově (5 dotazů
// nezávisle na počtu klientek), data čteme přes trenérské RLS.
async function buildBulkSummary(clientObjs, dates) {
  const ids = clientObjs.map((c) => c.id);
  if (ids.length === 0 || dates.length === 0) return [];
  const keyOf = (u, d) => `${u}|${d}`;

  // 1) diary_days pro všechny klientky a dny
  const { data: days } = await supabase
    .from('diary_days')
    .select('id, user_id, date')
    .in('user_id', ids)
    .in('date', dates);
  const dayRows = days || [];
  const dayIds = dayRows.map((d) => d.id);
  const dayIdByKey = new Map(dayRows.map((d) => [keyOf(d.user_id, d.date), d.id]));

  // 2) kalorie z entries + 3) poznámky — pro všechny day_id najednou
  const [entriesRes, notesRes] = await Promise.all([
    dayIds.length
      ? supabase.from('diary_entries').select('day_id, kcal').in('day_id', dayIds)
      : Promise.resolve({ data: [] }),
    dayIds.length
      ? supabase.from('meal_notes').select('day_id, note_text').in('day_id', dayIds)
      : Promise.resolve({ data: [] }),
  ]);
  const kcalByDay = new Map();
  const hasEntryByDay = new Set();
  for (const e of entriesRes.data || []) {
    hasEntryByDay.add(e.day_id);
    kcalByDay.set(e.day_id, (kcalByDay.get(e.day_id) || 0) + (e.kcal || 0));
  }
  const noteByDay = new Map();
  for (const n of notesRes.data || []) {
    const t = (n.note_text || '').trim();
    if (!t) continue;
    const prev = noteByDay.get(n.day_id);
    noteByDay.set(n.day_id, prev ? `${prev}\n${t}` : t);
  }

  // 4) váha zapsaná přímo v daný den
  const { data: weights } = await supabase
    .from('weight_entries')
    .select('user_id, date, weight')
    .in('user_id', ids)
    .in('date', dates);
  const weightByKey = new Map((weights || []).map((w) => [keyOf(w.user_id, w.date), w.weight]));

  // 5) goal_history (kcal) pro historizovaný cíl daného dne
  const { data: gh } = await supabase
    .from('goal_history')
    .select('user_id, date, goal_kcal')
    .in('user_id', ids)
    .order('date', { ascending: true });
  const histByUser = new Map();
  for (const r of gh || []) {
    if (!histByUser.has(r.user_id)) histByUser.set(r.user_id, []);
    histByUser.get(r.user_id).push({ date: r.date, goal_kcal: r.goal_kcal });
  }

  // 6) Neaktivita (jako dnešek): kolik dní zpět je poslední zápis jídla / váhy.
  //    Čistě z DB (žádný Claude, žádné kredity). Koukáme max 14 dní zpět —
  //    starší nebo žádný záznam = sentinel 15 → v UI "14+".
  const today = toDateStr(new Date());
  const cutoff = dateNDaysAgoStr(14);
  const [recentDaysRes, recentWeightsRes] = await Promise.all([
    supabase.from('diary_days').select('id, user_id, date')
      .in('user_id', ids).gte('date', cutoff).lte('date', today),
    supabase.from('weight_entries').select('user_id, date')
      .in('user_id', ids).gte('date', cutoff).lte('date', today),
  ]);
  const recentDayRows = recentDaysRes.data || [];
  const recentDayIds = recentDayRows.map((d) => d.id);
  const recentEntriesRes = recentDayIds.length
    ? await supabase.from('diary_entries').select('day_id').in('day_id', recentDayIds)
    : { data: [] };
  const dayIdsWithEntries = new Set((recentEntriesRes.data || []).map((e) => e.day_id));

  const lastFoodByUser = new Map();
  for (const d of recentDayRows) {
    if (!dayIdsWithEntries.has(d.id)) continue; // prázdný den se nepočítá jako zápis
    const prev = lastFoodByUser.get(d.user_id);
    if (!prev || d.date > prev) lastFoodByUser.set(d.user_id, d.date);
  }
  const lastWeightByUser = new Map();
  for (const w of recentWeightsRes.data || []) {
    const prev = lastWeightByUser.get(w.user_id);
    if (!prev || w.date > prev) lastWeightByUser.set(w.user_id, w.date);
  }
  const foodDaysAgoByUser = new Map();
  const weightDaysAgoByUser = new Map();
  for (const id of ids) {
    const lf = lastFoodByUser.get(id);
    foodDaysAgoByUser.set(id, lf ? daysBetweenStr(lf, today) : 15);
    const lw = lastWeightByUser.get(id);
    weightDaysAgoByUser.set(id, lw ? daysBetweenStr(lw, today) : 15);
  }

  const rows = [];
  for (const date of dates) {
    for (const client of clientObjs) {
      const k = keyOf(client.id, date);
      const dId = dayIdByKey.get(k) ?? null;
      const hasEntries = dId != null && hasEntryByDay.has(dId);
      const kcalTotal = dId != null ? Math.round(kcalByDay.get(dId) || 0) : 0;
      const goalKcal =
        getGoalForDate(date, histByUser.get(client.id) || [], client.goal_kcal ?? 2000, 'goal_kcal') ?? 2000;
      const pct = hasEntries && goalKcal > 0 ? Math.round((kcalTotal / goalKcal) * 100) : null;
      // Stejná pravidla jako kruh v DailySummary: >110 % červená, 90–110 % zelená, jinak oranžová.
      const color = pct == null ? 'none' : pct > 110 ? 'red' : pct >= 90 ? 'green' : 'orange';
      rows.push({
        key: k,
        name: client.display_name || client.email || 'Bez jména',
        date,
        hasEntries,
        kcalTotal,
        goalKcal,
        pct,
        color,
        weight: weightByKey.has(k) ? weightByKey.get(k) : null,
        note: dId != null ? noteByDay.get(dId) || null : null,
        foodDaysAgo: foodDaysAgoByUser.get(client.id) ?? 15,
        weightDaysAgo: weightDaysAgoByUser.get(client.id) ?? 15,
      });
    }
  }
  return rows;
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenStr(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000);
}

function dateNDaysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

// Popisek neaktivity: null pod 2 dny (jeden vynechaný den neřešíme),
// "2".."14" jinak, "14+" nad 14 dní. Sentinel 15 = déle / nikdy v okně.
function inactivityLabel(daysAgo) {
  if (daysAgo == null || daysAgo < 2) return null;
  return daysAgo > 14 ? '14+' : String(daysAgo);
}

function dayWord(label) {
  if (label === '14+') return 'dní';
  const n = Number(label);
  return n >= 2 && n <= 4 ? 'dny' : 'dní';
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
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'
  const { clients: activeClients, loading: activeLoading, refresh: refreshActive } = useClientList('active');
  const { clients: archivedClients, loading: archivedLoading, refresh: refreshArchived } = useClientList('archived');
  const isArchivedView = activeTab === 'archived';
  const clients = isArchivedView ? archivedClients : activeClients;
  const loading = isArchivedView ? archivedLoading : activeLoading;
  const refresh = useCallback(async () => {
    await Promise.all([refreshActive(), refreshArchived()]);
  }, [refreshActive, refreshArchived]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkSummary, setBulkSummary] = useState(null); // pole řádků přehledu po dokončení
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageResult, setMessageResult] = useState(null); // { ok, count } | { error }
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedDates, setSelectedDates] = useState(new Set([getLast7Days()[1]])); // default: včera
  const [deleteTarget, setDeleteTarget] = useState(null); // client object pending delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [statusBusyId, setStatusBusyId] = useState(null);

  // Reset výběru při překliknutí mezi záložkami
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkResult(null);
    setBulkSummary(null);
  }, [activeTab]);

  async function archiveClient(client, e) {
    e.stopPropagation();
    setStatusBusyId(client.id);
    const ok = await setClientStatus(client.id, 'archived');
    setStatusBusyId(null);
    if (ok) await refresh();
  }

  async function restoreClient(client, e) {
    e.stopPropagation();
    setStatusBusyId(client.id);
    const ok = await setClientStatus(client.id, 'active');
    setStatusBusyId(null);
    if (ok) await refresh();
  }

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
    setBulkSummary(null);
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

      // Po dokončení sestav trenérský přehled okomentovaných klientek.
      try {
        const clientObjs = clients.filter((c) => selectedIds.has(c.id));
        const summary = await buildBulkSummary(clientObjs, dates);
        setBulkSummary(summary);
      } catch (sumErr) {
        console.error('Summary build error:', sumErr);
      }
    } catch (err) {
      console.error('Bulk comment error:', err);
      setBulkResult({ error: 'Chyba při generování komentářů.' });
    }

    setBulkLoading(false);
  }

  function openMessageModal() {
    setMessageResult(null);
    setShowMessageModal(true);
  }

  function closeMessageModal() {
    setShowMessageModal(false);
    setMessageResult(null);
  }

  async function sendMessage() {
    const body = messageText.trim();
    if (!body || selectedIds.size === 0) return;
    setMessageSending(true);
    setMessageResult(null);
    try {
      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .insert({ trainer_id: user.id, body })
        .select('id')
        .single();
      if (annErr || !ann) throw annErr || new Error('insert failed');

      const rows = [...selectedIds].map((uid) => ({
        announcement_id: ann.id,
        user_id: uid,
      }));
      const { error: recErr } = await supabase
        .from('announcement_recipients')
        .insert(rows);
      if (recErr) throw recErr;

      setMessageResult({ ok: true, count: rows.length });
      setMessageText('');
    } catch (err) {
      console.error('Send message error:', err);
      setMessageResult({ error: 'Zprávu se nepodařilo odeslat.' });
    }
    setMessageSending(false);
  }

  if (loading) {
    return <div className="trainer-loading">Načítání klientek...</div>;
  }

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;

  return (
    <div className="trainer-dashboard">
      <div className="trainer-dashboard-header">
        <h2 className="trainer-title">Klientky</h2>
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

      <div className="trainer-tabs">
        <button
          className={`trainer-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Aktivní ({activeClients.length})
        </button>
        <button
          className={`trainer-tab ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => setActiveTab('archived')}
        >
          Bývalé ({archivedClients.length})
        </button>
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

      {clients.length > 0 && !isArchivedView && (
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
            {selectedIds.size > 0 && (
              <button
                className="trainer-bulk-btn trainer-message-btn"
                onClick={openMessageModal}
              >
                ✉️ Poslat zprávu ({selectedIds.size} kl.)
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

      {bulkSummary && bulkSummary.length > 0 && (() => {
        const multiDate = new Set(bulkSummary.map((r) => r.date)).size > 1;
        return (
          <div className="trainer-summary">
            <div className="trainer-summary-title">Přehled okomentovaných klientek</div>
            <div className="trainer-summary-scroll">
              <table className="trainer-summary-table">
                <thead>
                  <tr>
                    <th>Klientka</th>
                    {multiDate && <th>Den</th>}
                    <th>Kalorie</th>
                    <th>Váha</th>
                    <th>Poznámka</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkSummary.map((r) => {
                    const foodLbl = inactivityLabel(r.foodDaysAgo);
                    const weightLbl = inactivityLabel(r.weightDaysAgo);
                    return (
                    <tr key={r.key}>
                      <td className="summary-name">{r.name}</td>
                      {multiDate && <td className="summary-date">{shortDate(r.date)}</td>}
                      <td>
                        {r.color === 'none' ? (
                          <span className="summary-muted">
                            bez zápisu
                            {foodLbl && (
                              <span style={{ color: '#e8730c', fontWeight: 600 }}>
                                {' · '}{foodLbl} {dayWord(foodLbl)} v řadě
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="summary-kcal">
                            <span
                              className="summary-dot"
                              style={{ background: KCAL_COLORS[r.color] }}
                            />
                            {r.kcalTotal} / {r.goalKcal} kcal
                            <span className="summary-pct"> ({r.pct} %)</span>
                          </span>
                        )}
                      </td>
                      <td>
                        {r.weight != null ? (
                          <span className="summary-yes">✓ {r.weight} kg</span>
                        ) : weightLbl ? (
                          <span style={{ color: '#e8730c', fontWeight: 600 }}>
                            {weightLbl} {dayWord(weightLbl)} bez váhy
                          </span>
                        ) : (
                          <span className="summary-muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.note ? (
                          <span className="summary-yes summary-note" title={r.note}>✓</span>
                        ) : (
                          <span className="summary-muted">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      {clients.length === 0 ? (
        <div className="trainer-empty">
          {isArchivedView ? 'Žádné bývalé klientky.' : 'Zatím žádné klientky.'}
        </div>
      ) : (
        <div className="trainer-client-list">
          {clients.map((client) => (
            <div
              key={client.id}
              className={`trainer-client-card ${selectedIds.has(client.id) ? 'selected' : ''} ${isArchivedView ? 'archived' : ''}`}
              onClick={() => onSelectClient(client)}
            >
              {!isArchivedView && (
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
              )}
              <div className="client-avatar">
                {(client.display_name || client.email)[0].toUpperCase()}
              </div>
              <div className="client-info">
                <span className="client-name">
                  {client.display_name || 'Bez jména'}
                </span>
                <span className="client-email">{client.email}</span>
              </div>
              {isArchivedView ? (
                <button
                  className="client-status-btn client-restore-btn"
                  onClick={(e) => restoreClient(client, e)}
                  disabled={statusBusyId === client.id}
                  title="Vrátit mezi aktivní klientky"
                >
                  ↩
                </button>
              ) : (
                <button
                  className="client-status-btn client-archive-btn"
                  onClick={(e) => archiveClient(client, e)}
                  disabled={statusBusyId === client.id}
                  title="Přesunout mezi bývalé klientky"
                >
                  📦
                </button>
              )}
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

      {showMessageModal && (
        <div className="delete-modal-overlay" onClick={closeMessageModal}>
          <div className="delete-modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              Poslat zprávu ({selectedIds.size}{' '}
              {selectedIds.size === 1 ? 'klientce' : 'klientkám'})
            </h3>
            {messageResult?.ok ? (
              <div className="invite-result">
                <p style={{ marginBottom: 12 }}>
                  ✅ Odesláno {messageResult.count}{' '}
                  {messageResult.count === 1 ? 'klientce' : 'klientkám'}. Zobrazí se jim
                  při otevření aplikace.
                </p>
                <button
                  className="trainer-bulk-btn trainer-bulk-btn-all"
                  onClick={closeMessageModal}
                  style={{ width: '100%' }}
                >
                  Zavřít
                </button>
              </div>
            ) : (
              <>
                <textarea
                  placeholder="Např.: Přes víkend budu pryč, komentáře doplním v pondělí. 🙂"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="auth-input"
                  rows={4}
                  style={{ marginBottom: 12, width: '100%', resize: 'vertical' }}
                />
                {messageResult?.error && (
                  <div className="delete-error">{messageResult.error}</div>
                )}
                <button
                  className="trainer-bulk-btn trainer-bulk-btn-all"
                  onClick={sendMessage}
                  disabled={messageSending || !messageText.trim()}
                  style={{ width: '100%' }}
                >
                  {messageSending
                    ? 'Odesílám...'
                    : `Odeslat ${selectedIds.size} ${selectedIds.size === 1 ? 'klientce' : 'klientkám'}`}
                </button>
                <button
                  className="trainer-select-all-btn"
                  onClick={closeMessageModal}
                  style={{ width: '100%', marginTop: 8 }}
                >
                  Zrušit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
