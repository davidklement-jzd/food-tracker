import { supabase } from '../lib/supabase';

export function round(val) {
  return val != null ? Math.round(val * 10) / 10 : '–';
}

export function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Hledá v Supabase tabulce `foods` (USDA + budoucí OFF + ruční záznamy).
// Trigram + ILIKE: vrací nejbližší shody seřazené podle kvality (confidence)
// a délky názvu (kratší = obecnější = relevantnější).
export async function searchSupabaseFoods(query, limit = 15) {
  const q = query.trim();
  if (q.length < 2) return [];
  // RPC search_foods používá pg_trgm fuzzy match (tolerantní k jednotnému/množnému číslu, překlepům)
  const { data, error } = await supabase.rpc('search_foods', { q, lim: limit });
  if (error) {
    console.error('Supabase food search error:', error);
    return [];
  }
  return data || [];
}

// Konvertuje řádek z Supabase `foods` na product objekt používaný v UI
// (stejný tvar jako OpenFoodFacts produkt, ať modal nemusí rozlišovat).
export function supabaseFoodToProduct(f) {
  const portions = Array.isArray(f.portions) && f.portions.length > 0
    ? f.portions
    : (f.default_grams ? [{ label: 'Porce', grams: Number(f.default_grams) }] : null);
  return {
    id: f.id,
    product_name: f.title,
    brands: f.brand || f.category || '',
    _isLocal: true,
    _source: f.source,
    _isLiquid: !!f.is_liquid,
    serving_size: f.default_grams ? `${f.default_grams}g` : null,
    portions,
    nutriments: {
      'energy-kcal_100g': f.kcal,
      proteins_100g: f.protein,
      carbohydrates_100g: f.carbs,
      fat_100g: f.fat,
      fiber_100g: f.fiber,
    },
  };
}

export function parseServingSize(str) {
  if (!str) return null;
  const match = str.match(/([\d.,]+)\s*g/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

export function formatServingLabel(product) {
  const ss = product.serving_size;
  if (!ss) return null;
  const grams = parseServingSize(ss);
  if (!grams) return null;
  return `1 porce (${ss})`;
}

// Konvertuje řádek z RPC get_recent_foods na product objekt používaný v modalu.
// Přibalí `_recent` meta + `_lastGrams` pro předvyplnění množství v detailu.
export function recentFoodToProduct(r) {
  // Stejný fallback jako supabaseFoodToProduct: když foods nemá portions,
  // ale má default_grams, vytvoříme syntetickou "Porci".
  const portions = Array.isArray(r.portions) && r.portions.length > 0
    ? r.portions
    : (r.default_grams ? [{ label: 'Porce', grams: Number(r.default_grams) }] : null);
  return {
    // Reálné food_id (nebo null) — handleAdd ho dá do diary_entries.food_id,
    // který má FK na foods(id). Syntetické "recent_*" by hodilo FK error.
    id: r.food_id || null,
    product_name: r.name,
    brands: r.brand || '',
    _isLocal: true,
    _isLiquid: !!r.is_liquid,
    _recent: true,
    _lastGrams: r.last_grams,
    _lastDisplayAmount: r.last_display_amount,
    serving_size: null,
    portions,
    nutriments: {
      'energy-kcal_100g': r.kcal,
      proteins_100g: r.protein,
      carbohydrates_100g: r.carbs,
      fat_100g: r.fat,
      fiber_100g: r.fiber,
    },
  };
}

// Vrátí label porce s gramy. Pokud label už obsahuje gramáž v závorce
// (např. "1 banán (120g)"), nepřidává duplicitní suffix.
export function portionLabel(p) {
  if (!p) return '';
  const hasGrams = /\(\s*\d+(?:[.,]\d+)?\s*(g|ml)\s*\)/i.test(p.label);
  return hasGrams ? p.label : `${p.label} (${p.grams}g)`;
}
