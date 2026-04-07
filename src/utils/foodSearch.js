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

// Vrátí label porce s gramy. Pokud label už obsahuje gramáž v závorce
// (např. "1 banán (120g)"), nepřidává duplicitní suffix.
export function portionLabel(p) {
  if (!p) return '';
  const hasGrams = /\(\s*\d+(?:[.,]\d+)?\s*(g|ml)\s*\)/i.test(p.label);
  return hasGrams ? p.label : `${p.label} (${p.grams}g)`;
}
