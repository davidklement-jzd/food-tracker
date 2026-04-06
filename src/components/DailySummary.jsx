const DEFAULT_GOALS = { goal_kcal: 2000, goal_protein: 100, goal_carbs: 220, goal_fat: 80, goal_fiber: 30 };

export default function DailySummary({ entries, profile }) {
  const goals = { ...DEFAULT_GOALS, ...profile };
  const GOAL_KCAL = goals.goal_kcal;
  const GOALS = { protein: goals.goal_protein, carbs: goals.goal_carbs, fat: goals.goal_fat, fiber: goals.goal_fiber };
  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + (e.kcal || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
      fiber: acc.fiber + (e.fiber || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
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
        <MacroRow label="Bílkoviny" value={totals.protein} goal={GOALS.protein} />
        <MacroRow label="Sacharidy" value={totals.carbs} goal={GOALS.carbs} />
        <MacroRow label="Tuky" value={totals.fat} goal={GOALS.fat} />
        <MacroRow label="Vláknina" value={totals.fiber} goal={GOALS.fiber} />
      </div>
    </div>
  );
}

function MacroRow({ label, value, goal }) {
  const rawPct = Math.round((value / goal) * 100);
  const barPct = Math.min(rawPct, 100);
  const color = rawPct > 110 ? '#e53935' : rawPct >= 90 ? '#43a047' : '#fb8c00';
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
