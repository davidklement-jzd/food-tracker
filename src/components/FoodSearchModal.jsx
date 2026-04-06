import { useState, useEffect, useRef } from 'react';
import { round, searchCzechFoods, czechFoodToProduct, parseServingSize, formatServingLabel } from '../utils/foodSearch';

export default function FoodSearchModal({ mealLabel, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null); // selected product
  const [amount, setAmount] = useState({ value: '', unit: 'g' });
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

    const czResults = searchCzechFoods(query.trim()).map(czechFoodToProduct);
    if (czResults.length > 0) {
      setResults(czResults.slice(0, 12));
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `/api/off/cgi/search.pl?search_terms=${encodeURIComponent(query.trim())}&json=1&page_size=6&fields=id,product_name,brands,nutriments,image_small_url,serving_size,serving_quantity`;
        const res = await fetch(url);
        const data = await res.json();
        const onlineResults = (data.products || []).filter((p) => p.product_name);
        const czIds = new Set(czResults.map((r) => r.id));
        const combined = [
          ...czResults,
          ...onlineResults.filter((p) => !czIds.has(p.id)),
        ].slice(0, 12);
        setResults(combined);
      } catch {
        if (czResults.length === 0) setResults([]);
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
    if (hasPortions) {
      setAmount({ value: '1', unit: 'portion_0' });
    } else if (sGrams) {
      setAmount({ value: '1', unit: 'serving' });
    } else {
      setAmount({ value: '100', unit: 'g' });
    }
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

    let displayAmount;
    if (amount.unit === 'serving' && servingGrams) {
      const count = parseFloat(amount.value) || 1;
      displayAmount = `${count}× porce (${Math.round(gramsTotal)}g)`;
    } else if (amount.unit.startsWith('portion_')) {
      const idx = parseInt(amount.unit.split('_')[1]);
      const p = portions[idx];
      if (p) {
        const count = parseFloat(amount.value) || 1;
        displayAmount = count > 1 ? `${count}× ${p.label} (${Math.round(gramsTotal)}g)` : `${p.label} (${p.grams}g)`;
      } else {
        displayAmount = `${Math.round(gramsTotal)}g`;
      }
    } else {
      displayAmount = `${Math.round(gramsTotal)}g`;
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{mealLabel}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!selected ? (
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
          </>
        ) : (
          <div className="modal-detail">
            <div className="modal-detail-name">{selected.product_name}</div>
            {selected.brands && (
              <div className="modal-detail-brand">{selected.brands}</div>
            )}
            <div className="modal-detail-kcal">
              {round(previewN['energy-kcal_100g'])} kcal / 100g
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
                    value: newUnit === 'g' ? String(Math.round(previewGrams)) : '1',
                  });
                }}
                className="modal-amount-unit"
              >
                <option value="g">g</option>
                {portions.map((p, i) => (
                  <option key={i} value={`portion_${i}`}>{p.label} ({p.grams}g)</option>
                ))}
                {servingLabel && !portions.length && <option value="serving">{servingLabel}</option>}
              </select>
            </div>

            <div className="modal-preview">
              <div className="modal-preview-total">
                {Math.round(previewGrams)} g — <strong>{previewKcal} kcal</strong>
              </div>
              <div className="modal-preview-macros">
                <span className="macro-protein">{previewProtein}g B</span>
                <span className="macro-carbs">{previewCarbs}g S</span>
                <span className="macro-fat">{previewFat}g T</span>
                <span className="macro-fiber">{previewFiber}g V</span>
              </div>
            </div>

            <div className="modal-detail-actions">
              <button className="modal-btn-back" onClick={handleBack}>
                ← Zpět
              </button>
              <button className="modal-btn-add" onClick={handleAdd}>
                Přidat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
