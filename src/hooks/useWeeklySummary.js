import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getAllGoalsForDate } from './useGoalHistory';
import { addDays, daysInRange, formatWeekRange, formatShortDate } from '../utils/week';

const DEFAULT_GOALS = { goal_kcal: 2000, goal_protein: 100, goal_carbs: 220, goal_fat: 80, goal_fiber: 30 };

const MACROS = [
  { key: 'protein', label: 'Bílkoviny', goalKey: 'goal_protein', higherBetter: true },
  { key: 'carbs', label: 'Sacharidy', goalKey: 'goal_carbs', higherBetter: false },
  { key: 'fat', label: 'Tuky', goalKey: 'goal_fat', higherBetter: false },
  { key: 'fiber', label: 'Vláknina', goalKey: 'goal_fiber', higherBetter: true },
];

function round(n, d = 0) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// Barevný stav plnění: bílkoviny/vláknina zelené od 90 % (víc je líp),
// kalorie/sacharidy/tuky zelené jen v pásmu 90–110 %.
function statusFor(pct, higherBetter) {
  if (higherBetter) return pct >= 90 ? 'ok' : 'low';
  if (pct >= 90 && pct <= 110) return 'ok';
  return pct > 110 ? 'high' : 'low';
}

function latestOnOrBefore(rows, dateStr) {
  let found = null;
  for (const r of rows) {
    if (r.date <= dateStr) found = r;
    else break;
  }
  return found;
}

// Denní součty maker z vnořených entries.
function dayTotals(entries) {
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + (e.kcal || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
      fiber: acc.fiber + (e.fiber || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}

// Metriky jednoho týdne. clientStart = datum, odkdy je klientkou (jmenovatel
// se počítá jen od tohoto data — částečný první týden neukáže „X ze 7").
function computeWeek(ws, we, totalsByDate, goalHistory, fallback, clientStart) {
  const available = daysInRange(ws, we).filter((d) => !clientStart || d >= clientStart);
  const loggedDates = available.filter((d) => totalsByDate[d]);

  const macroAgg = Object.fromEntries(MACROS.map((m) => [m.key, { intake: 0, goal: 0 }]));
  let kcalPctSum = 0;
  let kcalSum = 0;
  let kcalIn = 0;
  let kcalOver = 0;
  let kcalUnder = 0;

  for (const d of loggedDates) {
    const t = totalsByDate[d];
    const goals = getAllGoalsForDate(d, goalHistory, fallback);
    const gKcal = goals.goal_kcal || DEFAULT_GOALS.goal_kcal;
    const pct = (t.kcal / gKcal) * 100;
    kcalPctSum += pct;
    kcalSum += t.kcal;
    if (pct >= 90 && pct <= 110) kcalIn++;
    else if (pct > 110) kcalOver++;
    else kcalUnder++;

    for (const m of MACROS) {
      macroAgg[m.key].intake += t[m.key] || 0;
      macroAgg[m.key].goal += goals[m.goalKey] || DEFAULT_GOALS[m.goalKey];
    }
  }

  const n = loggedDates.length;
  const macros = MACROS.map((m) => {
    const agg = macroAgg[m.key];
    const avg = n ? agg.intake / n : 0;
    const goal = n ? agg.goal / n : DEFAULT_GOALS[m.goalKey];
    const pct = goal ? (avg / goal) * 100 : 0;
    return {
      key: m.key,
      label: m.label,
      avg: round(avg),
      goal: round(goal),
      pct: round(pct),
      status: statusFor(pct, m.higherBetter),
    };
  });

  return {
    availableDays: available.length,
    loggedDays: n,
    avgKcal: n ? round(kcalSum / n) : 0,
    avgPctKcal: n ? round(kcalPctSum / n) : 0,
    kcalIn,
    kcalOver,
    kcalUnder,
    macros,
    fiberAvg: macros.find((x) => x.key === 'fiber').avg,
  };
}

export function useWeeklySummary(userId, week, profile, goalHistory) {
  const [summary, setSummary] = useState({ loading: true, empty: true });

  const start = week?.start;
  const end = week?.end;

  useEffect(() => {
    if (!userId || !start || !end) {
      setSummary({ loading: false, empty: true });
      return;
    }

    let cancelled = false;

    async function run() {
      setSummary((s) => ({ ...s, loading: true }));

      const prevStart = addDays(start, -7);
      const rangeStart = prevStart; // vč. minulého týdne kvůli srovnání
      const fallback = { ...DEFAULT_GOALS, ...(profile || {}) };
      const clientStart = profile?.created_at ? profile.created_at.slice(0, 10) : null;

      const [daysRes, weightRes] = await Promise.all([
        supabase
          .from('diary_days')
          .select('date, diary_entries(kcal, protein, carbs, fat, fiber)')
          .eq('user_id', userId)
          .gte('date', rangeStart)
          .lte('date', end),
        supabase
          .from('weight_entries')
          .select('weight, date')
          .eq('user_id', userId)
          .lte('date', end)
          .order('date', { ascending: true }),
      ]);

      if (cancelled) return;

      const totalsByDate = {};
      for (const row of daysRes.data || []) {
        const entries = row.diary_entries || [];
        if (entries.length > 0) totalsByDate[row.date] = dayTotals(entries);
      }

      const target = computeWeek(start, end, totalsByDate, goalHistory, fallback, clientStart);

      if (target.loggedDays === 0) {
        setSummary({
          loading: false,
          empty: true,
          rangeLabel: formatWeekRange(start, end),
        });
        return;
      }

      const prev = computeWeek(prevStart, addDays(start, -1), totalsByDate, goalHistory, fallback, clientStart);

      // Váha
      const weightRows = weightRes.data || [];
      const wEnd = latestOnOrBefore(weightRows, end);
      const wBefore = latestOnOrBefore(weightRows, addDays(start, -1));
      const weekChange = wEnd && wBefore ? round(wEnd.weight - wBefore.weight, 1) : null;
      let cumulative = null;
      if (wEnd != null) {
        if (profile?.initial_weight != null) cumulative = round(wEnd.weight - profile.initial_weight, 1);
        else if (weightRows.length > 0) cumulative = round(wEnd.weight - weightRows[0].weight, 1);
      }
      const points = weightRows.filter((r) => r.date >= start && r.date <= end);

      // Změna kalorického cíle uvnitř týdne
      let goalChange = null;
      const weekDays = daysInRange(start, end);
      let prevKcal = null;
      for (const d of weekDays) {
        const g = getAllGoalsForDate(d, goalHistory, fallback).goal_kcal;
        if (prevKcal != null && g !== prevKcal) {
          goalChange = { label: formatShortDate(d), from: prevKcal, to: g };
          break;
        }
        prevKcal = g;
      }

      // Srovnání s minulým týdnem (jen když má minulý týden zápisy)
      const compare = prev.loggedDays > 0
        ? {
            daysDiff: target.loggedDays - prev.loggedDays,
            kcalDiff: round(target.avgKcal - prev.avgKcal),
            fiberDiff: round(target.fiberAvg - prev.fiberAvg),
          }
        : null;

      // Největší odchylka pod cíl mezi makry
      const underMacros = target.macros.filter((m) => m.pct < 95);
      let biggest = null;
      if (underMacros.length > 0) {
        biggest = underMacros.reduce((a, b) => (a.pct <= b.pct ? a : b));
      }

      setSummary({
        loading: false,
        empty: false,
        rangeLabel: formatWeekRange(start, end),
        availableDays: target.availableDays,
        loggedDays: target.loggedDays,
        kcal: { avg: target.avgKcal, pct: target.avgPctKcal, inGoal: target.kcalIn, over: target.kcalOver, under: target.kcalUnder },
        macros: target.macros,
        weight: { weekChange, cumulative, points },
        goalChange,
        compare,
        biggest: biggest ? { label: biggest.label, pct: biggest.pct } : null,
      });
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, start, end, profile, goalHistory]);

  return summary;
}
