import { useState } from 'react';
import { useClientList } from '../hooks/useTrainerData';
import { supabase } from '../lib/supabase';

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d}.${m}.`;
}

export default function TrainerDashboard({ onSelectClient }) {
  const { clients, loading } = useClientList();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  async function commentAllClients() {
    setBulkLoading(true);
    setBulkResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-all-comments', {
        body: { date: yesterdayStr() },
      });

      if (error) {
        console.error('Bulk comment error:', error);
        setBulkResult({ error: 'Chyba při generování komentářů.' });
      } else {
        setBulkResult({
          success: true,
          generated: data.generated || 0,
          skipped: data.skipped || 0,
        });
      }
    } catch (err) {
      console.error('Bulk comment error:', err);
      setBulkResult({ error: 'Chyba při generování komentářů.' });
    }

    setBulkLoading(false);
  }

  if (loading) {
    return <div className="trainer-loading">Načítání klientek...</div>;
  }

  return (
    <div className="trainer-dashboard">
      <div className="trainer-dashboard-header">
        <h2 className="trainer-title">Klientky ({clients.length})</h2>
        {clients.length > 0 && (
          <button
            className="trainer-bulk-btn trainer-bulk-btn-all"
            onClick={commentAllClients}
            disabled={bulkLoading}
          >
            {bulkLoading
              ? '⏳ Generuji komentáře...'
              : `🤖 Okomentovat všechny (${formatDateShort(yesterdayStr())})`}
          </button>
        )}
      </div>
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
              className="trainer-client-card"
              onClick={() => onSelectClient(client)}
            >
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
