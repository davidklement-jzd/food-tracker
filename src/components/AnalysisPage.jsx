import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { useAuth } from '../contexts/AuthContext';
import { useWeightTracker } from '../hooks/useWeightTracker';
import { useCalorieHistory } from '../hooks/useCalorieHistory';
import { useGoalHistory, getGoalForDate } from '../hooks/useGoalHistory';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);


function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function getCalorieColor(kcal, goal) {
  if (!goal) return '#4caf50';
  const pct = (kcal / goal) * 100;
  if (pct > 110) return '#e53935';
  if (pct >= 90) return '#4caf50';
  return '#fb8c00';
}

export default function AnalysisPage({ onBack, targetUserId, targetProfile }) {
  const { user, profile: ownProfile } = useAuth();
  const userId = targetUserId || user?.id;
  const profile = targetProfile || ownProfile;
  const today = new Date().toISOString().split('T')[0];
  const { history, loading: weightLoading } = useWeightTracker(userId, today);
  const { calorieHistory, calorieLoading } = useCalorieHistory(userId);
  const { goalHistory } = useGoalHistory(userId);

  const goalWeight = profile?.target_weight || null;
  const goalKcal = profile?.goal_kcal || 2000;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  const xTicksLimit = isMobile ? 6 : 12;

  // Weight chart
  const weightLabels = history.map((e) => formatDateLabel(e.date));
  const weights = history.map((e) => e.weight);
  const minWeight = weights.length > 0 ? Math.floor(Math.min(...weights, goalWeight || Infinity)) - 2 : 60;
  const maxWeight = weights.length > 0 ? Math.ceil(Math.max(...weights, goalWeight || 0)) + 2 : 100;

  const weightChartData = {
    labels: weightLabels,
    datasets: [
      {
        data: weights,
        borderColor: '#f4845f',
        backgroundColor: 'rgba(244, 132, 95, 0.25)',
        fill: true,
        tension: 0.3,
        pointRadius: weights.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#f4845f',
        borderWidth: 2,
      },
      ...(goalWeight
        ? [{
            data: Array(weightLabels.length).fill(goalWeight),
            borderColor: '#b8860b',
            borderDash: [8, 5],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          }]
        : []),
    ],
  };

  const weightChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} kg` } },
      legend: { display: false },
    },
    scales: {
      x: {
        ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: xTicksLimit, font: { size: isMobile ? 9 : 11 }, color: '#999' },
        grid: { display: false },
      },
      y: {
        min: minWeight, max: maxWeight,
        ticks: { stepSize: 1, font: { size: 11 }, color: '#999' },
        grid: { color: '#f0f0f0' },
      },
    },
  };

  // Calorie chart – with dynamic goal line
  const calLabels = calorieHistory.map((e) => formatDateLabel(e.date));
  const calValues = calorieHistory.map((e) => e.kcal);
  const calGoalPerDay = calorieHistory.map((e) => getGoalForDate(e.date, goalHistory, goalKcal));
  const calColors = calorieHistory.map((e, i) => getCalorieColor(e.kcal, calGoalPerDay[i]));

  const calorieChartData = {
    labels: calLabels,
    datasets: [
      {
        type: 'bar',
        data: calValues,
        backgroundColor: calColors,
        borderRadius: 3,
        barPercentage: 0.7,
        order: 2,
      },
      {
        type: 'line',
        data: calGoalPerDay,
        borderColor: '#b8860b',
        borderDash: [8, 5],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 1,
      },
    ],
  };

  const calorieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} kcal` } },
      legend: { display: false },
    },
    scales: {
      x: {
        ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: xTicksLimit, font: { size: isMobile ? 9 : 11 }, color: '#999' },
        grid: { display: false },
      },
      y: {
        beginAtZero: false,
        ticks: { font: { size: 11 }, color: '#999' },
        grid: { color: '#f0f0f0' },
      },
    },
  };

  return (
    <div className="analysis-page">
      <div className="analysis-card">
        <div className="analysis-header">
          <button className="settings-back-btn" onClick={onBack}>
            ← Zpět
          </button>
          <h2>Analýza</h2>
        </div>

        <div className="analysis-section">
          <h3>Hmotnost</h3>
          {weightLoading ? (
            <p className="analysis-loading">Načítání...</p>
          ) : history.length === 0 ? (
            <p className="analysis-empty">Zatím žádné záznamy váhy.</p>
          ) : (
            <div className="analysis-chart-container">
              <Line data={weightChartData} options={weightChartOptions} />
            </div>
          )}
          {goalWeight && history.length > 0 && (
            <div className="analysis-legend">
              <span className="legend-item">
                <span className="legend-line legend-weight" />
                Váha
              </span>
              <span className="legend-item">
                <span className="legend-line legend-goal" />
                Cílová váha ({goalWeight} kg)
              </span>
            </div>
          )}
        </div>

        <div className="analysis-section">
          <h3>Energetický příjem</h3>
          {calorieLoading ? (
            <p className="analysis-loading">Načítání...</p>
          ) : calorieHistory.length === 0 ? (
            <p className="analysis-empty">Zatím žádné záznamy jídelníčku.</p>
          ) : (
            <div className="analysis-chart-container">
              <Bar data={calorieChartData} options={calorieChartOptions} />
            </div>
          )}
          {calorieHistory.length > 0 && (
            <div className="analysis-legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#4caf50' }} />
                V cíli (90–110%)
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#fb8c00' }} />
                Pod cílem
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#e53935' }} />
                Nad cílem
              </span>
              <span className="legend-item legend-target">
                Cíl: {goalKcal} kcal
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
