import { useState } from 'react';
import { useClientList } from '../hooks/useTrainerData';
import { supabase } from '../lib/supabase';

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

export default function TrainerDashboard({ onSelectClient }) {
  const { clients, loading } = useClientList();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedDates, setSelectedDates] = useState(new Set([getLast7Days()[1]])); // default: včera

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
    setBulkLoading(true);
    setBulkResult(null);

    let totalGenerated = 0;
    let totalSkipped = 0;

    try {
      const clientIds = [...selectedIds];
      const dates = [...selectedDates].sort();

      for (const date of dates) {
        const { data, error } = await supabase.functions.invoke('generate-all-comments', {
          body: { date, client_ids: clientIds },
        });

        if (error) {
          console.error('Bulk comment error:', error);
          setBulkResult({ error: 'Chyba při generování komentářů.' });
          setBulkLoading(false);
          return;
        }
        totalGenerated += data.generated || 0;
        totalSkipped += data.skipped || 0;
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
      </div>

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
                  ? '⏳ Generuji komentáře...'
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
              <span className="client-arrow">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
