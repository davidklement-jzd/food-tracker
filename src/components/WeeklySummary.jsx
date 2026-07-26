const STATUS_COLOR = { ok: '#43a047', low: '#fb8c00', high: '#e53935' };

function num(n) {
  return n.toLocaleString('cs-CZ');
}

function kg(n, signed = false) {
  const s = n.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${signed && n > 0 ? '+' : ''}${s} kg`;
}

function diffText(v, unit) {
  if (v === 0) return 'beze změny';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} ${unit}`;
}

function daysDiffText(v) {
  if (v === 0) return 'beze změny';
  const a = Math.abs(v);
  const w = a === 1 ? 'den' : a >= 2 && a <= 4 ? 'dny' : 'dní';
  return `${v > 0 ? '+' : '−'}${a} ${w}`;
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const ws = points.map((p) => p.weight);
  const min = Math.min(...ws);
  const max = Math.max(...ws);
  const span = max - min || 1;
  const W = 90;
  const H = 36;
  const pad = 4;
  const step = (W - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (p.weight - min) / span) * (H - pad * 2);
    return [x, y];
  });
  const path = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <polyline points={path} fill="none" stroke="#78909c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="#78909c" />
    </svg>
  );
}

export default function WeeklySummary({ summary, onClose }) {
  const s = summary || {};

  return (
    <div className="weekly-summary-card" onClick={(e) => e.stopPropagation()}>
      <div className="weekly-header">
        <div>
          <div className="weekly-title">Váš týden</div>
          {s.rangeLabel && <div className="weekly-range">{s.rangeLabel}</div>}
        </div>
        <button className="weekly-close" onClick={onClose} aria-label="Zavřít">×</button>
      </div>

      {s.loading ? (
        <div className="weekly-note">Načítám…</div>
      ) : s.empty ? (
        <div className="weekly-note">V tomto týdnu není žádný zápis.</div>
      ) : (
        <div className="weekly-body">
          <div className="weekly-section">
            <div className="weekly-label">Zapisování</div>
            <div className="weekly-line">
              Zapsáno <strong>{s.loggedDays} ze {s.availableDays} dní</strong>
            </div>
          </div>

          <div className="weekly-section">
            <div className="weekly-label">Kalorie</div>
            <div className="weekly-line weekly-row">
              <span>Ø <strong>{num(s.kcal.avg)} kcal</strong></span>
              <span className="weekly-muted">{s.kcal.pct} % denního cíle</span>
            </div>
            <div className="weekly-subline">
              V cíli {s.kcal.inGoal} dní · nad {s.kcal.over} · pod {s.kcal.under}
            </div>
          </div>

          <div className="weekly-section">
            <div className="weekly-label">Makra · průměr týdne vs. cíl</div>
            {s.macros.map((m) => (
              <div className="weekly-macro" key={m.key}>
                <span className="weekly-macro-name">
                  <span className="weekly-dot" style={{ background: STATUS_COLOR[m.status] }} />
                  {m.label}
                </span>
                <span>
                  {num(m.avg)} g <span className="weekly-muted">/ {num(m.goal)} g</span>{' '}
                  <span style={{ color: STATUS_COLOR[m.status], fontWeight: 600 }}>{m.pct} %</span>
                </span>
              </div>
            ))}
          </div>

          <div className="weekly-section">
            <div className="weekly-label">Váha</div>
            <div className="weekly-row">
              <div>
                {s.weight.weekChange != null ? (
                  <div className="weekly-line"><strong>{kg(s.weight.weekChange, true)}</strong> za týden</div>
                ) : (
                  <div className="weekly-line">Tento týden bez zápisu váhy</div>
                )}
                {s.weight.cumulative != null && (
                  <div className="weekly-subline">{kg(s.weight.cumulative, true)} od začátku</div>
                )}
              </div>
              <Sparkline points={s.weight.points} />
            </div>
          </div>

          {s.compare && (
            <div className="weekly-section">
              <div className="weekly-label">Srovnání s minulým týdnem</div>
              <div className="weekly-subline">
                Zapisování {daysDiffText(s.compare.daysDiff)} · kalorie {diffText(s.compare.kcalDiff, 'kcal')} · vláknina {diffText(s.compare.fiberDiff, 'g')}
              </div>
            </div>
          )}

          {s.goalChange && (
            <div className="weekly-goalchange">
              Kalorický cíl upraven {s.goalChange.label}: {num(s.goalChange.from)} → {num(s.goalChange.to)} kcal
            </div>
          )}

          <div className="weekly-section weekly-section--last">
            <div className="weekly-label">Největší odchylka</div>
            <div className="weekly-line">
              {s.biggest
                ? `Nejvíc pod cílem: ${s.biggest.label.toLowerCase()} (${s.biggest.pct} %)`
                : 'Všechna makra blízko cíle.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
