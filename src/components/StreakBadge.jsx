// Medaile série po sobě jdoucích dní zapisování. Stupně:
//   Bronz 1–6, Stříbro 7–29, Zlato 30–99, Diamant 100+.
const TIERS = [
  { min: 100, key: 'diamond', c1: '#7df0e0', c2: '#14b8a6', ring: '#0d9488' },
  { min: 30, key: 'gold', c1: '#ffe08a', c2: '#ffb300', ring: '#ff8f00' },
  { min: 7, key: 'silver', c1: '#eceff1', c2: '#b0bec5', ring: '#78909c' },
  { min: 1, key: 'bronze', c1: '#e6b98a', c2: '#cd7f32', ring: '#9c5a1e' },
];

const NEXT_TIERS = [
  { t: 7, name: 'stříbra' },
  { t: 30, name: 'zlata' },
  { t: 100, name: 'diamantu' },
];

function dayWord(n) {
  if (n === 1) return 'den';
  if (n >= 2 && n <= 4) return 'dny';
  return 'dní';
}

export default function StreakBadge({ streak = 0, loggedToday = false }) {
  const tier = TIERS.find((t) => streak >= t.min) || null;
  const active = !!tier;
  const c1 = active ? tier.c1 : '#eceff1';
  const c2 = active ? tier.c2 : '#cfd8dc';
  const ring = active ? tier.ring : '#b0bec5';
  const gradId = `streak-grad-${tier ? tier.key : 'none'}`;

  const nextTier = NEXT_TIERS.find((n) => streak < n.t);

  let caption;
  if (streak === 0) {
    caption = 'Zapiš dnešní jídlo a rozjeď sérii 🔥';
  } else if (!loggedToday) {
    caption = 'Dnes ještě nezapsáno — udrž sérii! 💪';
  } else if (nextTier) {
    const rem = nextTier.t - streak;
    caption = `Ještě ${rem} ${dayWord(rem)} do ${nextTier.name}`;
  } else {
    caption = 'Nejvyšší stupeň — makáš! 🔥';
  }

  return (
    <div className={`streak-badge${active ? '' : ' streak-badge--inactive'}`}>
      <svg
        viewBox="0 0 80 100"
        className="streak-medal"
        role="img"
        aria-label={`Série ${streak} ${dayWord(streak)} v řadě`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        {/* stužky za medailí */}
        <polygon points="30,54 40,59 40,97 33,88 26,97 27,59" fill={ring} opacity={active ? 0.85 : 0.5} />
        <polygon points="50,54 40,59 40,97 47,88 54,97 53,59" fill={ring} opacity={active ? 0.62 : 0.4} />
        {/* medaile */}
        <circle cx="40" cy="37" r="31" fill={`url(#${gradId})`} stroke={ring} strokeWidth="3" />
        <circle cx="40" cy="37" r="24" fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="2" />
        <text
          x="40"
          y="37"
          textAnchor="middle"
          dominantBaseline="central"
          className="streak-num"
          fill={active ? '#fff' : '#90a4ae'}
        >
          {streak}
        </text>
      </svg>
      <div className="streak-info">
        <span className="streak-count">
          {streak} {dayWord(streak)} v řadě
        </span>
        <span className="streak-caption">{caption}</span>
      </div>
    </div>
  );
}
