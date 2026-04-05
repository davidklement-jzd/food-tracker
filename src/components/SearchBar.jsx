import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import czechFoods from '../data/czechFoods';

function round(val) {
  return val != null ? Math.round(val * 10) / 10 : '–';
}

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchCzechFoods(query) {
  const q = normalize(query);
  return czechFoods.filter((f) => normalize(f.name).includes(q) || normalize(f.category).includes(q));
}

function czechFoodToProduct(f) {
  return {
    id: f.id,
    product_name: f.name,
    brands: f.category,
    _isCzech: true,
    serving_size: f.serving,
    nutriments: {
      'energy-kcal_100g': f.kcal,
      proteins_100g: f.protein,
      carbohydrates_100g: f.carbs,
      fat_100g: f.fat,
    },
  };
}

function parseServingSize(str) {
  if (!str) return null;
  const match = str.match(/([\d.,]+)\s*g/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

function formatServingLabel(product) {
  const ss = product.serving_size;
  if (!ss) return null;
  const grams = parseServingSize(ss);
  if (!grams) return null;
  // Try to make a nice label like "1 balení (140g)" or "1 porce (30g)"
  return `1 porce (${ss})`;
}

const SearchBar = forwardRef(function SearchBar({ targetMeal, meals, onMealChange, onAdd }, ref) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState({}); // { [pid]: { value, unit: 'g' | 'serving' } }
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    // Okamžitě hledej v české DB
    const czResults = searchCzechFoods(query.trim()).map(czechFoodToProduct);
    if (czResults.length > 0) {
      setResults(czResults.slice(0, 12));
      setOpen(true);
    }

    // S debouncem dohledej i online
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `/api/off/cgi/search.pl?search_terms=${encodeURIComponent(query.trim())}&json=1&page_size=6&fields=id,product_name,brands,nutriments,image_small_url,serving_size,serving_quantity`;
        const res = await fetch(url);
        const data = await res.json();
        const onlineResults = (data.products || []).filter(
          (p) => p.product_name
        );
        // Czech first, then online (deduplicated)
        const czIds = new Set(czResults.map((r) => r.id));
        const combined = [
          ...czResults,
          ...onlineResults.filter((p) => !czIds.has(p.id)),
        ].slice(0, 12);
        setResults(combined);
        setOpen(true);
      } catch {
        // Keep Czech results if online fails
        if (czResults.length === 0) setResults([]);
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
      // Default: if serving exists use serving, else 100g
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
          ref={inputRef}
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
          <div className="dropdown-meal-bar">
            <span className="meal-bar-label">Přidat do:</span>
            <div className="meal-bar-pills">
              {meals.map((m) => (
                <button
                  key={m.id}
                  className={`meal-pill ${targetMeal === m.id ? 'active' : ''}`}
                  onClick={() => onMealChange(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {results.map((product) => {
            const n = product.nutriments || {};
            const pid = product.id || product._id;
            const servingLabel = formatServingLabel(product);
            const amt = amounts[pid] || {};
            const unit = amt.unit || (servingLabel ? 'serving' : 'g');

            return (
              <div key={pid} className="search-result-item">
                <div className={`result-thumb ${product._isCzech ? 'czech' : ''}`}>
                  {product.image_small_url ? (
                    <img src={product.image_small_url} alt="" />
                  ) : product._isCzech ? (
                    <div className="thumb-placeholder">🇨🇿</div>
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
});

export default SearchBar;
