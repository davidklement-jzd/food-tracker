import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { lookupByEan } from '../utils/barcodeLookup';

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
      const prefill = { _isNew: true, ean: code };
      if (result.source === 'off' && result.off) {
        prefill.title = result.off.title || '';
        prefill.kcal = result.off.kcal ?? '';
        prefill.protein = result.off.protein ?? '';
        prefill.carbs = result.off.carbs ?? '';
        prefill.fat = result.off.fat ?? '';
        prefill.fiber = result.off.fiber ?? '';
        prefill.is_liquid = !!result.off.isLiquid;
        prefill._scanInfo = `Načteno z Open Food Facts (EAN ${code}). Zkontroluj/doplň hodnoty.`;
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
    const t = setTimeout(fetchList, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchList, query]);

  const tabs = isTrainer
    ? [
        { id: 'pending', label: 'Čeká na schválení' },
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

      <div className="foods-db-search">
        <input
          type="text"
          placeholder="Hledat podle názvu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <span className="foods-db-loading">…</span>}
      </div>

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

      {scannerOpen && (
        <Suspense fallback={<div className="scanner-overlay"><div className="scanner-status">Načítám skener…</div></div>}>
          <BarcodeScanner
            onDetected={handleScanned}
            onClose={() => setScannerOpen(false)}
          />
        </Suspense>
      )}

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
        {rows.map((row) => {
          const canEdit =
            isTrainer || (row.created_by === user.id && row.status === 'pending');
          return (
            <div key={row.id} className={`foods-db-row status-${row.status}`}>
              <div className="foods-db-row-main" onClick={() => canEdit && openEdit(row)}>
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
                    onClick={() => handleQuickApprove(row)}
                    title="Rychle schválit beze změny"
                  >
                    ✓
                  </button>
                  <button
                    className="foods-db-btn-edit"
                    onClick={() => openEdit(row)}
                    title="Upravit a schválit"
                  >
                    ✎
                  </button>
                  <button
                    className="foods-db-btn-delete"
                    onClick={() => handleDelete(row)}
                    title="Smazat"
                  >
                    🗑
                  </button>
                </div>
              )}
              {isTrainer && row.status !== 'pending' && (
                <div className="foods-db-row-actions">
                  <button
                    className="foods-db-btn-edit"
                    onClick={() => openEdit(row)}
                    title="Upravit"
                  >
                    ✎
                  </button>
                  <button
                    className="foods-db-btn-delete"
                    onClick={() => handleDelete(row)}
                    title="Smazat"
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

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

  function updatePortion(idx, key, value) {
    setForm((f) => ({
      ...f,
      portions: f.portions.map((p, i) => (i === idx ? { ...p, [key]: value } : p)),
    }));
  }

  function addPortion() {
    setForm((f) => ({ ...f, portions: [...f.portions, { label: '', grams: '' }] }));
  }

  function removePortion(idx) {
    setForm((f) => ({ ...f, portions: f.portions.filter((_, i) => i !== idx) }));
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

    const portionsClean = [];
    for (const p of form.portions) {
      const label = (p.label || '').trim();
      const g = parseFloat(String(p.grams ?? '').replace(',', '.'));
      if (label === '' && !Number.isFinite(g)) continue;
      if (label === '' || !Number.isFinite(g) || g <= 0) {
        return setError('Porce: vyplň label i gramáž (>0), nebo řádek smaž.');
      }
      portionsClean.push({ label, grams: Math.round(g * 10) / 10 });
    }
    const portionsValue = portionsClean.length > 0 ? portionsClean : null;

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

            <div className="modal-portions-editor">
              <div className="modal-portions-header">
                <span>Doporučené porce</span>
                <button
                  type="button"
                  className="modal-portions-add"
                  onClick={addPortion}
                >
                  + Přidat
                </button>
              </div>
              {form.portions.length === 0 && (
                <div className="modal-portions-empty">
                  Žádné porce — klientka bude volit jen přesné gramy.
                </div>
              )}
              {form.portions.map((p, i) => (
                <div key={i} className="modal-portions-row">
                  <input
                    type="text"
                    placeholder="Název (např. 1 kus)"
                    value={p.label}
                    onChange={(e) => updatePortion(i, 'label', e.target.value)}
                    className="modal-portions-label"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="g"
                    value={p.grams}
                    onChange={(e) => updatePortion(i, 'grams', e.target.value)}
                    className="modal-portions-grams"
                  />
                  <span className="modal-portions-unit">
                    {form.isLiquid ? 'ml' : 'g'}
                  </span>
                  <button
                    type="button"
                    className="modal-portions-remove"
                    onClick={() => removePortion(i)}
                    title="Smazat"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

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
