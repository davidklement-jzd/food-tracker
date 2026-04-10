// EAN/UPC lookup. Nejdřív zkusí Supabase `foods.ean`, pak Open Food Facts.
// Vrací: { source: 'local'|'off'|'none', food?: <foods row>, off?: { title, kcal, protein, carbs, fat, fiber } }

import { supabase } from '../lib/supabase';
import { isLikelyLiquid } from '../hooks/useSupabaseDiary';

const LIQUID_QUANTITY_RE = /\b(m\s*l|cl|dl|l(?:itr))\b/i;

export async function lookupByEan(ean) {
  if (!ean) return { source: 'none' };

  // 1) Lokální DB (RLS sám pustí jen viditelné záznamy)
  const { data: local, error: localErr } = await supabase
    .from('foods')
    .select('*')
    .eq('ean', ean)
    .limit(1)
    .maybeSingle();

  if (localErr) console.warn('Local EAN lookup error:', localErr);
  if (local) return { source: 'local', food: local };

  // 2) Open Food Facts (světová DB, zdarma, bez API klíče)
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_cs,nutriments,brands,quantity,serving_size`,
      {
        headers: {
          // OFF prosí klienty, ať se identifikují přes UA
          'User-Agent': 'JakNaZdraveTelo/1.0 (food-tracker)',
        },
      }
    );
    if (!res.ok) return { source: 'none' };
    const json = await res.json();
    if (json.status !== 1 || !json.product) return { source: 'none' };

    const p = json.product;
    const n = p.nutriments || {};
    const title =
      p.product_name_cs ||
      p.product_name ||
      [p.brands, p.quantity].filter(Boolean).join(' ') ||
      `Produkt ${ean}`;

    const isLiquid =
      isLikelyLiquid(title) ||
      LIQUID_QUANTITY_RE.test(p.quantity || '') ||
      LIQUID_QUANTITY_RE.test(p.serving_size || '');

    const r1 = (v) => v != null ? Math.round(v * 10) / 10 : null;

    return {
      source: 'off',
      off: {
        title,
        kcal: r1(n['energy-kcal_100g']),
        protein: r1(n.proteins_100g),
        carbs: r1(n.carbohydrates_100g),
        fat: r1(n.fat_100g),
        fiber: r1(n.fiber_100g),
        isLiquid,
      },
    };
  } catch (e) {
    console.warn('OFF lookup error:', e);
    return { source: 'none' };
  }
}
