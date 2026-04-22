import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { lookupByEan } from '../utils/barcodeLookup';
import PortionsEditor, { cleanPortions } from './PortionsEditor';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return 0;
  return Math.round(Number(v) * 10) / 10;
}

const SOURCE_LABEL = {
  user: 'Uživatelská',
  manual: 'Ručně',
  off: 'Open Food Facts',
  usda: 'USDA',
};

const STATUS_LABEL = {
  approved: '✓ schválená',
  pending: '⏳ čeká',
  rejected: '✕ zamítnutá',
};

export default function FoodsDatabasePage({ onBack }) {
  const { user, isTrainer } = useAuth();
  const [tab, setTab] = useState(isTrainer ? 'pending' : 'all');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);

  async function handleScanned(code) {
    setScannerOpen(false);
    setScanLoading(true);
    try {
      const result = await lookupByEan(code);
      if (result.source === 'local' && result.food) {
        // Už je v DB → otevři k editaci
        openEdit(result.food);
        return;
      }
      // In-store kód (prefix 2) není globálně unikátní → neukládáme EAN.
      const isInStore = result.source === 'in-store';
      const prefill = { _isNew: true, ean: isInStore ? null : code };
      if (result.source === 'off' && result.off) {
        prefill.title = result.off.title || '';
        prefill.kcal = result.off.kcal ?? '';
        prefill.protein = result.off.protein ?? '';
        prefill.carbs = result.off.carbs ?? '';
        prefill.fat = result.off.fat ?? '';
        prefill.fiber = result.off.fiber ?? '';
        prefill.is_liquid = !!result.off.isLiquid;
        prefill._scanInfo = `Načteno z Open Food Facts (EAN ${code}). Zkontroluj/doplň hodnoty.`;
      } else if (isInStore) {
        prefill._scanInfo = `Kód ${code} je interní kód obchodu (není globálně jedinečný). Vyplň potravinu ručně — kód se neuloží.`;
      } else {
        prefill._scanInfo = `Kód ${code} nebyl nalezen — vyplň hodnoty z obalu.`;
      }
      setEditing(prefill);
    } finally {
      setScanLoading(false);
    }
  }

  const fetchList = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let q = supabase
      .from('foods')
      .select(isTrainer ? '*, creator:profiles!foods_created_by_fkey(display_name, email)' : '*');

    if (tab === 'pending') {
      q = q.eq('status', 'pending');
    } else if (tab === 'mine') {
      q = q.eq('created_by', user.id);
    }
    // 'all' → RLS sám propustí approved + own pending (+ trenér vidí všechno)

    const trimmed = query.trim();
    if (trimmed) {
      q = q.ilike('title', `%${trimmed}%`);
    }

    q = q.order('created_at', { ascending: false }).limit(150);

    const { data, error } = await q;
    if (error) {
      console.error('Foods list error:', error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [user, tab, query, isTrainer]);

  useEffect(() => {
    if (tab === 'suggestions') return;
    const t = setTimeout(fetchList, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchList, query, tab]);

  const fetchSuggestionCount = useCallback(async () => {
    if (!isTrainer) return;
    const { count } = await supabase
      .from('food_portion_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    setSuggestionCount(count || 0);
  }, [isTrainer]);

  useEffect(() => {
    fetchSuggestionCount();
  }, [fetchSuggestionCount]);

  const tabs = isTrainer
    ? [
        { id: 'pending', label: 'Čeká na schválení' },
        {
          id: 'suggestions',
          label: suggestionCount > 0
            ? `Návrhy úprav porcí (${suggestionCount})`
            : 'Návrhy úprav porcí',
        },
        { id: 'all', label: 'Všechny' },
        { id: 'mine', label: 'Moje přidané' },
      ]
    : [
        { id: 'all', label: 'Všechny' },
        { id: 'mine', label: 'Moje přidané' },
      ];

  function openEdit(row) {
    // Klient může editovat jen svoje pending, trenér cokoliv
    const canEdit =
      isTrainer || (row.created_by === user.id && row.status === 'pending');
    if (!canEdit) return;
    setEditing(row);
  }

  async function handleSaved(updatedRow, { propagated, isNew }) {
    if (isNew) {
      setRows((prev) => [updatedRow, ...prev]);
    } else {
      setRows((prev) => prev.map((r) => (r.id === updatedRow.id ? updatedRow : r)));
      if (tab === 'pending' && updatedRow.status !== 'pending') {
        setRows((prev) => prev.filter((r) => r.id !== updatedRow.id));
      }
    }
    setEditing(null);
  }

  async function handleQuickApprove(row) {
    if (!isTrainer) return;
    const { data, error } = await supabase
      .from('foods')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select()
      .single();
    if (error) {
      alert('Schválení selhalo: ' + error.message);
      return;
    }
    setRows((prev) =>
      tab === 'pending'
        ? prev.filter((r) => r.id !== row.id)
        : prev.map((r) => (r.id === row.id ? data : r))
    );
  }

  async function handleDelete(row) {
    if (!isTrainer) return;
    if (!confirm(`Smazat „${row.title}" ze sdílené databáze?\n\nZáznamy v jídelníčcích klientek zůstanou zachované.`)) {
      return;
    }
    const { error } = await supabase.from('foods').delete().eq('id', row.id);
    if (error) {
      alert('Smazání selhalo: ' + error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  return (
    <div className="foods-db-page">
      <div className="foods-db-header">
        <button className="foods-db-back" onClick={onBack}>← Zpět</button>
        <h1 className="foods-db-title">Databáze surovin</h1>
      </div>

      <div className="foods-db-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`foods-db-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'suggestions' && (
        <div className="foods-db-search">
          <input
            type="text"
            placeholder="Hledat podle názvu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && <span className="foods-db-loading">…</span>}
        </div>
      )}

      {tab !== 'suggestions' && (
        <div className="foods-db-add-buttons">
          <button
            className="foods-db-scan-btn"
            onClick={() => setScannerOpen(true)}
            disabled={scanLoading}
          >
            📷 {scanLoading ? 'Hledám…' : 'Naskenovat čárový kód'}
          </button>
          <button className="foods-db-add-btn" onClick={() => setEditing({ _isNew: true })}>
            ➕ Přidat ručně
          </button>
        </div>
      )}

      {scannerOpen && (
        <Suspense fallback={<div className="scanner-overlay"><div className="scanner-status">Načítám skener…</div></div>}>
          <BarcodeScanner
            onDetected={handleScanned}
            onClose={() => setScannerOpen(false)}
          />
        </Suspense>
      )}

      {tab === 'suggestions' && isTrainer && (
        <PortionSuggestionsPanel
          onChange={(delta) => setSuggestionCount((c) => Math.max(0, c + delta))}
        />
      )}

      {tab !== 'suggestions' && (
        <div className="foods-db-list">
          {rows.length === 0 && !loading && (
            <div className="foods-db-empty">
              {tab === 'pending'
                ? 'Žádné potraviny nečekají na schválení.'
                : tab === 'mine'
                  ? 'Zatím jsi nepřidal/a žádnou potravinu.'
                  : 'Nic nenalezeno.'}
            </div>
          )}
          {rows.map((row) => (
            <FoodRow
              key={row.id}
              row={row}
              isTrainer={isTrainer}
              userId={user.id}
              onEdit={openEdit}
              onApprove={handleQuickApprove}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {editing && (
        <FoodEditModal
          food={editing}
          isTrainer={isTrainer}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function FoodEditModal({ food, isTrainer, onClose, onSaved }) {
  const { user } = useAuth();
  const isNew = !!food._isNew;
  const [form, setForm] = useState({
    title: food.title || '',
    kcal: food.kcal ?? '',
    protein: food.protein ?? '',
    carbs: food.carbs ?? '',
    fat: food.fat ?? '',
    fiber: food.fiber ?? '',
    isLiquid: food.is_liquid ?? false,
    portions: Array.isArray(food.portions)
      ? food.portions.map((p) => ({ label: p.label || '', grams: p.grams ?? '' }))
      : [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function propagateToDiary(foodId, per100) {
    // Najdi všechny diary_entries vázané na tuto potravinu a přepočítej.
    const { data: entries, error } = await supabase
      .from('diary_entries')
      .select('id, grams')
      .eq('food_id', foodId);
    if (error) {
      console.error('Propagate fetch error:', error);
      return 0;
    }
    if (!entries || entries.length === 0) return 0;

    let updated = 0;
    for (const e of entries) {
      const f = (Number(e.grams) || 0) / 100;
      const { error: upErr } = await supabase
        .from('diary_entries')
        .update({
          kcal: round1((per100.kcal || 0) * f),
          protein: round1((per100.protein || 0) * f),
          carbs: round1((per100.carbs || 0) * f),
          fat: round1((per100.fat || 0) * f),
          fiber: round1((per100.fiber || 0) * f),
        })
        .eq('id', e.id);
      if (upErr) console.error('Propagate update error:', upErr);
      else updated++;
    }
    return updated;
  }

  async function save({ approve }) {
    setError(null);

    const parse = (v) => {
      const s = String(v ?? '').trim().replace(',', '.');
      if (s === '') return NaN;
      return parseFloat(s);
    };
    const title = form.title.trim();
    const kcal = parse(form.kcal);
    const protein = parse(form.protein);
    const carbs = parse(form.carbs);
    const fat = parse(form.fat);
    const fiberRaw = String(form.fiber ?? '').trim();
    const fiber = fiberRaw === '' ? null : parseFloat(fiberRaw.replace(',', '.'));

    if (!title) return setError('Zadej název.');
    if ([kcal, protein, carbs, fat].some((v) => !Number.isFinite(v) || v < 0)) {
      return setError('Vyplň kcal, B, S, T (čísla ≥ 0).');
    }
    if (fiber !== null && (!Number.isFinite(fiber) || fiber < 0)) {
      return setError('Vláknina musí být číslo ≥ 0 nebo prázdné.');
    }

    const cleaned = cleanPortions(form.portions);
    if (cleaned.error) return setError(cleaned.error);
    const portionsValue = cleaned.portions.length > 0 ? cleaned.portions : null;

    setSaving(true);
    try {
      const per100 = {
        kcal: round1(kcal),
        protein: round1(protein),
        carbs: round1(carbs),
        fat: round1(fat),
        fiber: fiber !== null ? round1(fiber) : null,
      };

      if (isNew) {
        const isLiquid = !!form.isLiquid;
        const liquidPortions = [
          { label: 'Sklenice (250 ml)', grams: 250 },
          { label: 'Plechovka (330 ml)', grams: 330 },
          { label: 'Půllitr (500 ml)', grams: 500 },
          { label: 'Litr (1000 ml)', grams: 1000 },
        ];

        const { data: inserted, error: insErr } = await supabase
          .from('foods')
          .insert({
            id: `user_${crypto.randomUUID()}`,
            title,
            ...per100,
            default_grams: 100,
            source: 'user',
            confidence: 4,
            status: isTrainer ? 'approved' : 'pending',
            created_by: user.id,
            is_liquid: isLiquid,
            portions: portionsValue || (isLiquid ? liquidPortions : null),
            ean: food.ean || null,
            ...(isTrainer ? { approved_by: user.id, approved_at: new Date().toISOString() } : {}),
          })
          .select()
          .single();

        if (insErr) {
          setError('Uložení selhalo: ' + insErr.message);
          return;
        }
        onSaved(inserted, { propagated: 0, isNew: true });
        return;
      }

      const update = {
        title,
        ...per100,
        is_liquid: !!form.isLiquid,
        portions: portionsValue,
      };

      if (isTrainer && approve) {
        update.status = 'approved';
        update.approved_by = user.id;
        update.approved_at = new Date().toISOString();
      }

      const { data: updated, error: upErr } = await supabase
        .from('foods')
        .update(update)
        .eq('id', food.id)
        .select()
        .single();

      if (upErr) {
        setError('Uložení selhalo: ' + upErr.message);
        return;
      }

      let propagated = 0;
      if (food.status === 'pending') {
        propagated = await propagateToDiary(food.id, per100);
      }

      onSaved(updated, { propagated });
    } catch (e) {
      setError('Chyba: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  const wasPending = food.status === 'pending';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isNew ? 'Přidat potravinu' : 'Upravit potravinu'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-detail">
          <div className="modal-create-toggle">
            <button
              type="button"
              className={`modal-toggle-btn ${!form.isLiquid ? 'active' : ''}`}
              onClick={() => set('isLiquid', false)}
            >
              🍴 Pevná
            </button>
            <button
              type="button"
              className={`modal-toggle-btn ${form.isLiquid ? 'active' : ''}`}
              onClick={() => set('isLiquid', true)}
            >
              🥤 Tekutina
            </button>
          </div>
          <div className="modal-detail-brand" style={{ marginBottom: 8 }}>
            Hodnoty na <strong>100 {form.isLiquid ? 'ml' : 'g'}</strong>.
            {!isNew && wasPending && isTrainer && (
              <> Změny se propíšou do jídelníčku autorky.</>
            )}
          </div>
          {food._scanInfo && (
            <div className="modal-scan-info">{food._scanInfo}</div>
          )}

          <div className="modal-create-form">
            <label className="modal-create-label">
              Název
              <input
                type="text"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                autoFocus={isNew}
              />
            </label>

            <label className="modal-create-label">
              kcal / 100 {form.isLiquid ? 'ml' : 'g'}
              <input
                type="text"
                inputMode="decimal"
                value={form.kcal}
                onChange={(e) => set('kcal', e.target.value)}
              />
            </label>

            <div className="modal-create-macros">
              <label className="modal-create-label">
                Bílkoviny (g)
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.protein}
                  onChange={(e) => set('protein', e.target.value)}
                />
              </label>
              <label className="modal-create-label">
                Sacharidy (g)
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.carbs}
                  onChange={(e) => set('carbs', e.target.value)}
                />
              </label>
              <label className="modal-create-label">
                Tuky (g)
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.fat}
                  onChange={(e) => set('fat', e.target.value)}
                />
              </label>
              <label className="modal-create-label">
                Vláknina (g) — volitelné
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.fiber}
                  onChange={(e) => set('fiber', e.target.value)}
                />
              </label>
            </div>

            <PortionsEditor
              value={form.portions}
              onChange={(p) => set('portions', p)}
              unit={form.isLiquid ? 'ml' : 'g'}
              emptyLabel="Žádné porce — klientka bude volit jen přesné gramy."
            />


            {error && <div className="modal-create-error">{error}</div>}
          </div>

        </div>

          <div className="modal-create-cta modal-create-actions">
            <button className="modal-btn-back" onClick={onClose} disabled={saving}>
              ← Zpět
            </button>
            {isNew ? (
              <button
                className="modal-btn-add"
                onClick={() => save({ approve: false })}
                disabled={saving}
              >
                {saving ? 'Ukládám…' : 'Uložit'}
              </button>
            ) : isTrainer && wasPending ? (
              <>
                <button
                  className="modal-btn-add"
                  onClick={() => save({ approve: false })}
                  disabled={saving}
                  style={{ background: '#888' }}
                >
                  Uložit
                </button>
                <button
                  className="modal-btn-add"
                  onClick={() => save({ approve: true })}
                  disabled={saving}
                >
                  {saving ? 'Ukládám…' : 'Uložit a schválit'}
                </button>
              </>
            ) : (
              <button
                className="modal-btn-add"
                onClick={() => save({ approve: false })}
                disabled={saving}
              >
                {saving ? 'Ukládám…' : 'Uložit'}
              </button>
            )}
          </div>
      </div>
    </div>
  );
}

function FoodRow({ row, isTrainer, userId, onEdit, onApprove, onDelete }) {
  const canEdit = isTrainer || (row.created_by === userId && row.status === 'pending');
  return (
    <div className={`foods-db-row status-${row.status}`}>
      <div className="foods-db-row-main" onClick={() => canEdit && onEdit(row)}>
        <div className="foods-db-row-title">
          {row.title}
          <span className={`foods-db-status status-${row.status}`}>
            {STATUS_LABEL[row.status] || row.status}
          </span>
        </div>
        <div className="foods-db-row-meta">
          <span>{round1(row.kcal)} kcal / 100 {row.is_liquid ? 'ml' : 'g'}</span>
          <span>B {round1(row.protein)}</span>
          <span>S {round1(row.carbs)}</span>
          <span>T {round1(row.fat)}</span>
          {row.fiber != null && <span>V {round1(row.fiber)}</span>}
          {isTrainer && row.creator && (
            <span className="foods-db-row-creator">
              👤 {row.creator.display_name || row.creator.email}
            </span>
          )}
          <span className="foods-db-row-source">
            {SOURCE_LABEL[row.source] || row.source}
          </span>
        </div>
      </div>
      {isTrainer && row.status === 'pending' && (
        <div className="foods-db-row-actions">
          <button
            className="foods-db-btn-approve"
            onClick={() => onApprove(row)}
            title="Rychle schválit beze změny"
          >✓</button>
          <button
            className="foods-db-btn-edit"
            onClick={() => onEdit(row)}
            title="Upravit a schválit"
          >✎</button>
          <button
            className="foods-db-btn-delete"
            onClick={() => onDelete(row)}
            title="Smazat"
          >🗑</button>
        </div>
      )}
      {isTrainer && row.status !== 'pending' && (
        <div className="foods-db-row-actions">
          <button
            className="foods-db-btn-edit"
            onClick={() => onEdit(row)}
            title="Upravit"
          >✎</button>
          <button
            className="foods-db-btn-delete"
            onClick={() => onDelete(row)}
            title="Smazat"
          >🗑</button>
        </div>
      )}
    </div>
  );
}

function portionsListToString(portions) {
  if (!Array.isArray(portions) || portions.length === 0) return '—';
  return portions.map((p) => `${p.label} (${p.grams}g)`).join(', ');
}

function PortionSuggestionsPanel({ onChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const { user } = useAuth();

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('food_portion_suggestions')
      .select(`
        id, food_id, suggested_portions, created_at,
        suggester:profiles!suggested_by(display_name, email),
        food:foods!food_id(id, title, portions, is_liquid)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Suggestions fetch error:', error);
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function approve(item) {
    setBusyId(item.id);
    try {
      const { error: upFoodErr } = await supabase
        .from('foods')
        .update({ portions: item.suggested_portions })
        .eq('id', item.food_id);
      if (upFoodErr) {
        alert('Přepis porcí selhal: ' + upFoodErr.message);
        return;
      }
      const { error: upSugErr } = await supabase
        .from('food_portion_suggestions')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (upSugErr) {
        alert('Návrh nelze uzavřít: ' + upSugErr.message);
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChange?.(-1);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(item) {
    setBusyId(item.id);
    try {
      const { error } = await supabase
        .from('food_portion_suggestions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) {
        alert('Zamítnutí selhalo: ' + error.message);
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChange?.(-1);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="foods-db-empty">Načítám návrhy…</div>;
  }
  if (items.length === 0) {
    return <div className="foods-db-empty">Žádné čekající návrhy úprav porcí.</div>;
  }

  return (
    <div className="portion-suggestions-list">
      {items.map((item) => (
        <div key={item.id} className="portion-suggestion-card">
          <div className="portion-suggestion-head">
            <span className="portion-suggestion-title">{item.food?.title || '(smazaná potravina)'}</span>
            <span className="portion-suggestion-author">
              👤 {item.suggester?.display_name || item.suggester?.email || 'Klientka'}
            </span>
          </div>
          <div className="portion-suggestion-row">
            <span className="portion-suggestion-label">Stávající:</span>
            <span className="portion-suggestion-value">{portionsListToString(item.food?.portions)}</span>
          </div>
          <div className="portion-suggestion-row">
            <span className="portion-suggestion-label">Navrženo:</span>
            <span className="portion-suggestion-value new">{portionsListToString(item.suggested_portions)}</span>
          </div>
          <div className="portion-suggestion-actions">
            <button
              className="foods-db-btn-delete"
              onClick={() => reject(item)}
              disabled={busyId === item.id}
              title="Zamítnout"
            >Zamítnout</button>
            <button
              className="foods-db-btn-approve"
              onClick={() => approve(item)}
              disabled={busyId === item.id}
              title="Schválit a přepsat"
            >✓ Schválit</button>
          </div>
        </div>
      ))}
    </div>
  );
}
