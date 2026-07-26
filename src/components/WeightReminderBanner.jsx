import { useState } from 'react';
import { todayStr } from '../utils/dates';

// Připomenutí zapsat váhu. Křížkem se skryje jen na dnešek (localStorage klíč
// obsahuje datum), takže se zítra zase objeví, pokud klientka pořád nezapsala.
export default function WeightReminderBanner({ userId, days }) {
  const storageKey = `weightReminderDismissed:${userId}:${todayStr()}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  function handleDismiss() {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // localStorage nedostupný (privátní režim) – jen skryjeme v paměti
    }
    setDismissed(true);
  }

  return (
    <div className="weight-reminder-banner" role="status">
      <span className="weight-reminder-icon" aria-hidden="true">⚖️</span>
      <span className="weight-reminder-text">
        Už {days} dní jste nezapsala aktuální váhu. Potřebuji vědět, jak Vaše tělo reaguje. Děkuji.
      </span>
      <button
        className="weight-reminder-dismiss"
        onClick={handleDismiss}
        aria-label="Skrýt na dnešek"
      >
        ×
      </button>
    </div>
  );
}
