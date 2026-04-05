const GOAL_KCAL = 2000;
const GOALS = { protein: 100, carbs: 220, fat: 80 };

export default function DailySummary({ entries }) {
  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + (e.kcal || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const rawPct = Math.round((totals.kcal / GOAL_KCAL) * 100);
  const pct = Math.min(rawPct, 100);
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (pct / 100) * circumference;
  const ringColor = rawPct > 110 ? '#e53935' : rawPct >= 90 ? '#43a047' : '#fb8c00';

  return (
    <div className="daily-summary">
      <div className="summary-ring-container">
        <svg viewBox="0 0 120 120" className="summary-ring">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#eee" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke={ringColor}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="ring-text" style={{ color: ringColor }}>
          <span className="ring-pct">{rawPct}%</span>
          <span className="ring-kcal">{Math.round(totals.kcal)} kcal</span>
          <span className="ring-goal">z {GOAL_KCAL} kcal</span>
        </div>
      </div>

      <div className="summary-macros">
        <MacroRow label="Bílkoviny" value={totals.protein} goal={GOALS.protein} color="#e53935" />
        <MacroRow label="Sacharidy" value={totals.carbs} goal={GOALS.carbs} color="#43a047" />
        <MacroRow label="Tuky" value={totals.fat} goal={GOALS.fat} color="#fb8c00" />
      </div>
    </div>
  );
}

function MacroRow({ label, value, goal, color }) {
  const rawPct = Math.round((value / goal) * 100);
  const barPct = Math.min(rawPct, 100);
  return (
    <div className="macro-row">
      <div className="macro-row-header">
        <span className="macro-label">{label}</span>
        <span className="macro-pct" style={{ background: color + '18', color }}>{rawPct}%</span>
      </div>
      <div className="macro-bar-bg">
        <div className="macro-bar-fill" style={{ width: barPct + '%', background: color }} />
      </div>
      <div className="macro-row-footer">
        <span className="macro-val">{Math.round(value * 10) / 10} g</span>
        <span className="macro-of">z {goal} g</span>
      </div>
    </div>
  );
}
