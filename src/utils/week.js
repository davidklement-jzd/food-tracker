import { toDateStr } from './dates';

const MONTHS_GEN = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toDateStr(dt);
}

// Pondělí kalendářního týdne, do kterého spadá dateStr (lokálně).
export function startOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 0 = pondělí ... 6 = neděle
  dt.setDate(dt.getDate() - dow);
  return toDateStr(dt);
}

// Poslední uzavřený týden (po–ne) vůči dnešku.
export function previousWeek(todayString) {
  const start = addDays(startOfWeek(todayString), -7);
  return { start, end: addDays(start, 6) };
}

// Klíč týdne pro localStorage (datum pondělí).
export function weekKey(week) {
  return week.start;
}

// Seznam dat YYYY-MM-DD od start do end včetně.
export function daysInRange(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// „20.–26. července" nebo přes hranici měsíce „29. června – 5. července".
export function formatWeekRange(start, end) {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (sm === em) {
    return `${sd}.–${ed}. ${MONTHS_GEN[sm - 1]}`;
  }
  return `${sd}. ${MONTHS_GEN[sm - 1]} – ${ed}. ${MONTHS_GEN[em - 1]}`;
}

// „23. 7."
export function formatShortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d}. ${m}.`;
}
