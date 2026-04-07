import { useState, useEffect, useRef } from 'react';
import { round, searchSupabaseFoods, supabaseFoodToProduct, parseServingSize, formatServingLabel } from '../utils/foodSearch';

export default function SearchBar({ onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState({});
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const localRows = await searchSupabaseFoods(query.trim(), 15);
        const products = localRows.map(supabaseFoodToProduct);
        setResults(products);
        setOpen(products.length > 0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function getGramsForProduct(pid, product) {
    const amt = amounts[pid];
    if (!amt || !amt.value) {
      const servingGrams = parseServingSize(product.serving_size);
      return servingGrams || 100;
    }
    if (amt.unit === 'serving') {
      const servingGrams = parseServingSize(product.serving_size);
      return servingGrams ? parseFloat(amt.value) * servingGrams : 100;
    }
    return parseFloat(amt.value) || 100;
  }

  function handleAdd(product) {
    const pid = product.id || product._id;
    const gramsTotal = getGramsForProduct(pid, product);
    const n = product.nutriments || {};
    const factor = gramsTotal / 100;
    const amt = amounts[pid];
    const servingGrams = parseServingSize(product.serving_size);

    let displayAmount;
    if (amt?.unit === 'serving' && servingGrams) {
      const count = parseFloat(amt.value) || 1;
      displayAmount = `${count}× porce (${Math.round(gramsTotal)}g)`;
    } else {
      displayAmount = `${Math.round(gramsTotal)}g`;
    }

    onAdd({
      id: Date.now() + Math.random(),
      name: product.product_name || 'Neznámé jídlo',
      brand: product.brands || '',
      grams: Math.round(gramsTotal),
      displayAmount,
      kcal: round((n['energy-kcal_100g'] || 0) * factor),
      protein: round((n.proteins_100g || 0) * factor),
      carbs: round((n.carbohydrates_100g || 0) * factor),
      fat: round((n.fat_100g || 0) * factor),
      fiber: round((n.fiber_100g || 0) * factor),
    });
    setQuery('');
    setResults([]);
    setOpen(false);
    setAmounts({});
  }

  function setAmount(pid, field, val) {
    setAmounts((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [field]: val },
    }));
  }

  return (
    <div className="search-container" ref={containerRef}>
      <div className="search-input-wrap">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="Hledej potraviny a recepty ..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
            ✕
          </button>
        )}
        {loading && <span className="search-loading">...</span>}
      </div>

      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((product) => {
            const n = product.nutriments || {};
            const pid = product.id || product._id;
            const servingLabel = formatServingLabel(product);
            const amt = amounts[pid] || {};
            const unit = amt.unit || (servingLabel ? 'serving' : 'g');

            return (
              <div key={pid} className="search-result-item">
                <div className={`result-thumb ${product._isLocal ? 'czech' : ''}`}>
                  {product.image_small_url ? (
                    <img src={product.image_small_url} alt="" />
                  ) : product._isLocal ? (
                    <div className="thumb-placeholder">🥗</div>
                  ) : (
                    <div className="thumb-placeholder">🍽</div>
                  )}
                </div>
                <div className="result-details">
                  <div className="result-name">
                    {product.product_name || 'Neznámé'}
                    {product.brands && <span className="result-brand"> {product.brands}</span>}
                  </div>
                  <div className="result-kcal">
                    {round(n['energy-kcal_100g'])} kcal / 100 g
                    {product.serving_size && (
                      <span className="result-serving"> · porce {product.serving_size}</span>
                    )}
                  </div>
                </div>
                <div className="result-add-area">
                  <input
                    type="number"
                    min="1"
                    placeholder={unit === 'serving' ? '1' : '100'}
                    value={amt.value || ''}
                    onChange={(e) => setAmount(pid, 'value', e.target.value)}
                    className="result-grams"
                  />
                  <select
                    className="result-unit-select"
                    value={unit}
                    onChange={(e) => setAmount(pid, 'unit', e.target.value)}
                  >
                    <option value="g">g</option>
                    {servingLabel && (
                      <option value="serving">{servingLabel}</option>
                    )}
                  </select>
                  <button onClick={() => handleAdd(product)} className="result-add-btn" title="Přidat do jídelníčku">
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
