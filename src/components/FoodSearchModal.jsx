import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { round, searchSupabaseFoods, supabaseFoodToProduct, parseServingSize, formatServingLabel, portionLabel, recentFoodToProduct } from '../utils/foodSearch';
import { supabase } from '../lib/supabase';
import { lookupByEan } from '../utils/barcodeLookup';
import { useRecentFoods } from '../hooks/useRecentFoods';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

export default function FoodSearchModal({ mealLabel, mealId, targetUserId = null, onAdd, onClose }) {
  // "Kalorický dluh" (supplements) je ruční sekce — trenér ji vyplňuje sám,
  // nedávné potraviny tam jen zavazí.
  const recentEnabled = mealId !== 'supplements';
  const { items: recentItems } = useRecentFoods({ mealId, enabled: recentEnabled, targetUserId });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null); // selected product
  const [amount, setAmount] = useState({ value: '', unit: 'g' });
  const [creating, setCreating] = useState(false); // 'Přidat novou' formulář
  const [createForm, setCreateForm] = useState({
    title: '',
    isLiquid: false,
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
  });
  const [createError, setCreateError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanInfo, setScanInfo] = useState(null); // text pod formulářem ("Načteno z OFF" apod.)
  const [pendingEan, setPendingEan] = useState(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const localRows = await searchSupabaseFoods(query.trim(), 15);
        setResults(localRows.map(supabaseFoodToProduct));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  function handleSelect(product) {
    setSelected(product);
    const hasPortions = product.portions && product.portions.length > 0;
    const sGrams = parseServingSize(product.serving_size);
    const baseUnit = product._isLiquid ? 'ml' : 'g';
    if (hasPortions) {
      setAmount({ value: '1', unit: 'portion_0' });
    } else if (sGrams) {
      setAmount({ value: '1', unit: 'serving' });
    } else {
      setAmount({ value: '100', unit: baseUnit });
    }
  }

  // Stejné jako handleSelect, ale přednastaví poslední použitou gramáž
  // v základní jednotce (g/ml). Pokud potravina má portions, zůstanou v dropdownu
  // k dispozici — klientka může přepnout.
  function handleSelectRecent(product) {
    setSelected(product);
    const baseUnit = product._isLiquid ? 'ml' : 'g';
    const lastGrams = product._lastGrams && product._lastGrams > 0
      ? String(Math.round(product._lastGrams))
      : '100';
    setAmount({ value: lastGrams, unit: baseUnit });
  }

  function handleBack() {
    setSelected(null);
    setAmount({ value: '', unit: 'g' });
  }

  function handleAdd() {
    if (!selected) return;
    const n = selected.nutriments || {};
    const gramsTotal = getComputedGrams();
    const factor = gramsTotal / 100;
    const isLiquid = !!selected._isLiquid;
    const u = isLiquid ? 'ml' : 'g';

    let displayAmount;
    if (amount.unit === 'serving' && servingGrams) {
      const count = parseFloat(amount.value) || 1;
      displayAmount = `${count}× porce (${Math.round(gramsTotal)}${u})`;
    } else if (amount.unit.startsWith('portion_')) {
      const idx = parseInt(amount.unit.split('_')[1]);
      const p = portions[idx];
      if (p) {
        const count = parseFloat(amount.value) || 1;
        displayAmount = count > 1 ? `${count}× ${p.label} (${Math.round(gramsTotal)}${u})` : portionLabel(p);
      } else {
        displayAmount = `${Math.round(gramsTotal)}${u}`;
      }
    } else {
      displayAmount = `${Math.round(gramsTotal)}${u}`;
    }

    onAdd({
      id: Date.now() + Math.random(),
      name: selected.product_name || 'Neznámé jídlo',
      brand: selected.brands || '',
      grams: Math.round(gramsTotal),
      displayAmount,
      kcal: round((n['energy-kcal_100g'] || 0) * factor),
      protein: round((n.proteins_100g || 0) * factor),
      carbs: round((n.carbohydrates_100g || 0) * factor),
      fat: round((n.fat_100g || 0) * factor),
      fiber: round((n.fiber_100g || 0) * factor),
      food_id: selected.id || null,
      unit: u,
      portions: portions && portions.length > 0 ? portions : null,
    });
    onClose();
  }

  const servingLabel = selected ? formatServingLabel(selected) : null;
  const servingGrams = selected ? parseServingSize(selected.serving_size) : null;
  const portions = selected?.portions || [];

  // Live preview of computed values
  function getComputedGrams() {
    if (!selected) return 0;
    if (amount.unit === 'serving' && servingGrams) {
      return (parseFloat(amount.value) || 1) * servingGrams;
    }
    if (amount.unit.startsWith('portion_')) {
      const idx = parseInt(amount.unit.split('_')[1]);
      const p = portions[idx];
      if (p) return (parseFloat(amount.value) || 1) * p.grams;
    }
    return parseFloat(amount.value) || 100;
  }

  const previewGrams = getComputedGrams();
  const previewFactor = previewGrams / 100;
  const previewN = selected?.nutriments || {};
  const previewKcal = round((previewN['energy-kcal_100g'] || 0) * previewFactor);
  const previewProtein = round((previewN.proteins_100g || 0) * previewFactor);
  const previewCarbs = round((previewN.carbohydrates_100g || 0) * previewFactor);
  const previewFat = round((previewN.fat_100g || 0) * previewFactor);
  const previewFiber = round((previewN.fiber_100g || 0) * previewFactor);

  function openCreate() {
    setCreateError(null);
    setCreateForm((f) => ({
      ...f,
      title: query.trim() || f.title,
    }));
    setScanInfo(null);
    setPendingEan(null);
    setCreating(true);
  }

  async function handleScanned(code) {
    setScannerOpen(false);
    setScanLoading(true);
    try {
      const result = await lookupByEan(code);
      if (result.source === 'local' && result.food) {
        // Máme to v naší DB → chovej se jako kdyby uživatel klikl ve výsledcích.
        const product = supabaseFoodToProduct(result.food);
        handleSelect(product);
        return;
      }
      if (result.source === 'off' && result.off) {
        // Předvyplň create formulář hodnotami z OFF.
        setCreateForm({
          title: result.off.title || '',
          kcal: result.off.kcal != null ? String(result.off.kcal) : '',
          protein: result.off.protein != null ? String(result.off.protein) : '',
          carbs: result.off.carbs != null ? String(result.off.carbs) : '',
          fat: result.off.fat != null ? String(result.off.fat) : '',
          fiber: result.off.fiber != null ? String(result.off.fiber) : '',
        });
        setScanInfo(`Načteno z Open Food Facts (EAN ${code}). Zkontroluj/doplň hodnoty.`);
        setPendingEan(code);
        setCreating(true);
        return;
      }
      // Nikde nenalezeno → otevři prázdný formulář s předvyplněným EAN.
      setCreateForm({
        title: '',
        kcal: '',
        protein: '',
        carbs: '',
        fat: '',
        fiber: '',
      });
      setScanInfo(`Kód ${code} nebyl nalezen — vyplň hodnoty z obalu.`);
      setPendingEan(code);
      setCreating(true);
    } finally {
      setScanLoading(false);
    }
  }

  function updateCreateField(key, value) {
    setCreateForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreateSubmit() {
    setCreateError(null);

    const title = createForm.title.trim();
    const parse = (v) => {
      const s = String(v ?? '').trim().replace(',', '.');
      if (s === '') return NaN;
      return parseFloat(s);
    };
    const kcalNum = parse(createForm.kcal);
    const proteinNum = parse(createForm.protein);
    const carbsNum = parse(createForm.carbs);
    const fatNum = parse(createForm.fat);
    const fiberRaw = String(createForm.fiber ?? '').trim();
    const fiberNum = fiberRaw === '' ? null : parseFloat(fiberRaw.replace(',', '.'));

    if (!title) {
      setCreateError('Zadej název potraviny.');
      return;
    }
    if ([kcalNum, proteinNum, carbsNum, fatNum].some((v) => !Number.isFinite(v) || v < 0)) {
      setCreateError('Vyplň kcal, bílkoviny, sacharidy a tuky (čísla ≥ 0).');
      return;
    }
    if (fiberNum !== null && (!Number.isFinite(fiberNum) || fiberNum < 0)) {
      setCreateError('Vláknina musí být číslo ≥ 0 (nebo prázdné).');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCreateError('Nejsi přihlášen/a.');
        return;
      }

      // Hodnoty jsou vždy na 100 g (jako nutriční etiketa).
      const per100 = {
        kcal: Math.round(kcalNum * 10) / 10,
        protein: Math.round(proteinNum * 10) / 10,
        carbs: Math.round(carbsNum * 10) / 10,
        fat: Math.round(fatNum * 10) / 10,
        fiber: fiberNum !== null ? Math.round(fiberNum * 10) / 10 : null,
      };

      const isLiquid = !!createForm.isLiquid;
      const foodId = `user_${crypto.randomUUID()}`;

      const liquidPortions = [
        { label: 'Sklenice (250 ml)', grams: 250 },
        { label: 'Plechovka (330 ml)', grams: 330 },
        { label: 'Půllitr (500 ml)', grams: 500 },
        { label: 'Litr (1000 ml)', grams: 1000 },
      ];

      const { data: inserted, error: insertErr } = await supabase
        .from('foods')
        .insert({
          id: foodId,
          title,
          kcal: per100.kcal,
          protein: per100.protein,
          carbs: per100.carbs,
          fat: per100.fat,
          fiber: per100.fiber,
          default_grams: 100,
          source: 'user',
          confidence: 4,
          status: 'pending',
          created_by: user.id,
          ean: pendingEan || null,
          is_liquid: isLiquid,
          portions: isLiquid ? liquidPortions : null,
        })
        .select()
        .single();

      if (insertErr) {
        console.error('Insert food error:', insertErr);
        setCreateError('Uložení selhalo: ' + insertErr.message);
        return;
      }

      // Rovnou zapiš do dnešního jídelníčku jako 100 g (resp. 100 ml) porce.
      const unit = isLiquid ? 'ml' : 'g';
      onAdd({
        id: Date.now() + Math.random(),
        name: inserted.title,
        brand: '',
        grams: 100,
        displayAmount: `100${unit}`,
        kcal: per100.kcal,
        protein: per100.protein,
        carbs: per100.carbs,
        fat: per100.fat,
        fiber: per100.fiber !== null ? per100.fiber : 0,
        food_id: inserted.id,
        unit,
        portions: isLiquid ? liquidPortions : null,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setCreateError('Neočekávaná chyba: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      {scannerOpen && (
        <Suspense fallback={<div className="scanner-overlay"><div className="scanner-status">Načítám skener…</div></div>}>
          <BarcodeScanner
            onDetected={handleScanned}
            onClose={() => setScannerOpen(false)}
          />
        </Suspense>
      )}
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{mealLabel}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {creating ? (
          <>
          <div className="modal-detail">
            <div className="modal-detail-name">
              {createForm.isLiquid ? 'Přidat novou tekutinu' : 'Přidat novou potravinu'}
            </div>
            <div className="modal-create-toggle">
              <button
                type="button"
                className={`modal-toggle-btn ${!createForm.isLiquid ? 'active' : ''}`}
                onClick={() => updateCreateField('isLiquid', false)}
              >
                🍴 Pevná
              </button>
              <button
                type="button"
                className={`modal-toggle-btn ${createForm.isLiquid ? 'active' : ''}`}
                onClick={() => updateCreateField('isLiquid', true)}
              >
                🥤 Tekutina
              </button>
            </div>
            <div className="modal-detail-brand" style={{ marginBottom: 8 }}>
              Hodnoty uveďte <strong>na 100 {createForm.isLiquid ? 'ml' : 'g'}</strong> (jako na nutriční etiketě).
            </div>
            {scanInfo && (
              <div className="modal-scan-info">{scanInfo}</div>
            )}

            <div className="modal-create-form">
              <label className="modal-create-label">
                Název
                <input
                  type="text"
                  value={createForm.title}
                  onChange={(e) => updateCreateField('title', e.target.value)}
                  placeholder="např. Skyr vanilka Pilos"
                  autoFocus
                />
              </label>

              <label className="modal-create-label">
                kcal / 100 {createForm.isLiquid ? 'ml' : 'g'}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={createForm.kcal}
                  onChange={(e) => updateCreateField('kcal', e.target.value)}
                />
              </label>

              <div className="modal-create-macros">
                <label className="modal-create-label">
                  Bílkoviny (g)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={createForm.protein}
                    onChange={(e) => updateCreateField('protein', e.target.value)}
                  />
                </label>
                <label className="modal-create-label">
                  Sacharidy (g)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={createForm.carbs}
                    onChange={(e) => updateCreateField('carbs', e.target.value)}
                  />
                </label>
                <label className="modal-create-label">
                  Tuky (g)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={createForm.fat}
                    onChange={(e) => updateCreateField('fat', e.target.value)}
                  />
                </label>
                <label className="modal-create-label">
                  Vláknina (g) — volitelné
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={createForm.fiber}
                    onChange={(e) => updateCreateField('fiber', e.target.value)}
                  />
                </label>
              </div>

              {createError && (
                <div className="modal-create-error">{createError}</div>
              )}
            </div>
          </div>

            <div className="modal-create-cta modal-create-actions">
              <button
                className="modal-btn-back"
                onClick={() => setCreating(false)}
                disabled={saving}
              >
                ← Zpět
              </button>
              <button
                className="modal-btn-add"
                onClick={handleCreateSubmit}
                disabled={saving}
              >
                {saving ? 'Ukládám…' : 'Uložit a přidat'}
              </button>
            </div>
          </>
        ) : !selected ? (
          <>
            <div className="modal-search">
              <span className="modal-search-icon">🔍</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="hledat ..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {loading && <span className="modal-loading">...</span>}
            </div>

            {recentEnabled && recentItems.length > 0 && query.trim().length < 2 && (
              <div className="modal-recent-section">
                <div className="modal-recent-title">🕒 Nedávné</div>
                {recentItems.map((r) => {
                  const product = recentFoodToProduct(r);
                  const unitLabel = r.unit === 'ml' ? 'ml' : 'g';
                  return (
                    <div
                      key={`recent_${r.name}_${r.food_id || ''}_${r.unit}`}
                      className="modal-result-item modal-recent-item"
                      onClick={() => handleSelectRecent(product)}
                    >
                      <span className="modal-result-name">
                        {r.name}
                        {r.brand && (
                          <span className="modal-result-brand"> · {r.brand}</span>
                        )}
                      </span>
                      <span className="modal-result-kcal">
                        {r.last_display_amount || `${r.last_grams}${unitLabel}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="modal-results">
              {results.map((product) => {
                const n = product.nutriments || {};
                const pid = product.id || product._id;
                return (
                  <div
                    key={pid}
                    className="modal-result-item"
                    onClick={() => handleSelect(product)}
                  >
                    <span className="modal-result-name">
                      {product.product_name || 'Neznámé'}
                      {product.brands && (
                        <span className="modal-result-brand"> · {product.brands}</span>
                      )}
                    </span>
                    <span className="modal-result-kcal">
                      {round(n['energy-kcal_100g'])} kcal/100g
                    </span>
                  </div>
                );
              })}
              {query.trim().length >= 2 && results.length === 0 && !loading && (
                <div className="modal-no-results">Nic nenalezeno</div>
              )}
            </div>

            <div className="modal-create-cta">
              <button
                className="modal-btn-scan"
                onClick={() => setScannerOpen(true)}
                disabled={scanLoading}
              >
                📷 {scanLoading ? 'Hledám…' : 'Naskenovat čárový kód'}
              </button>
              <button className="modal-btn-create" onClick={openCreate}>
                ➕ Přidat novou potravinu
              </button>
            </div>
          </>
        ) : (
          <>
          <div className="modal-detail">
            <div className="modal-detail-name">{selected.product_name}</div>
            {selected.brands && (
              <div className="modal-detail-brand">{selected.brands}</div>
            )}
            <div className="modal-detail-kcal">
              {round(previewN['energy-kcal_100g'])} kcal / 100 {selected._isLiquid ? 'ml' : 'g'}
            </div>

            <div className="modal-amount-label">Množství</div>
            <div className="modal-amount-row">
              <input
                type="number"
                min="1"
                value={amount.value}
                onChange={(e) => setAmount((a) => ({ ...a, value: e.target.value }))}
                className="modal-amount-input"
                autoFocus
              />
              <span className="modal-amount-x">×</span>
              <select
                value={amount.unit}
                onChange={(e) => {
                  const newUnit = e.target.value;
                  setAmount({
                    unit: newUnit,
                    value: newUnit === 'g' || newUnit === 'ml' ? String(Math.round(previewGrams)) : '1',
                  });
                }}
                className="modal-amount-unit"
              >
                <option value={selected._isLiquid ? 'ml' : 'g'}>
                  {selected._isLiquid ? 'ml' : 'g'}
                </option>
                {portions.map((p, i) => (
                  <option key={i} value={`portion_${i}`}>{portionLabel(p)}</option>
                ))}
                {servingLabel && !portions.length && <option value="serving">{servingLabel}</option>}
              </select>
            </div>

            <div className="modal-preview">
              <div className="modal-preview-total">
                {Math.round(previewGrams)} {selected._isLiquid ? 'ml' : 'g'} — <strong>{previewKcal} kcal</strong>
              </div>
              <div className="modal-preview-macros">
                <span className="macro-protein">{previewProtein}g B</span>
                <span className="macro-carbs">{previewCarbs}g S</span>
                <span className="macro-fat">{previewFat}g T</span>
                <span className="macro-fiber">{previewFiber}g V</span>
              </div>
            </div>
          </div>

            <div className="modal-create-cta modal-create-actions">
              <button className="modal-btn-back" onClick={handleBack}>
                ← Zpět
              </button>
              <button className="modal-btn-add" onClick={handleAdd}>
                Přidat
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
