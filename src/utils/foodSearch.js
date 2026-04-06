import czechFoods from '../data/czechFoods';

export function round(val) {
  return val != null ? Math.round(val * 10) / 10 : '–';
}

export function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function searchCzechFoods(query) {
  const q = normalize(query);
  return czechFoods.filter((f) => normalize(f.name).includes(q) || normalize(f.category).includes(q));
}

export function czechFoodToProduct(f) {
  return {
    id: f.id,
    product_name: f.name,
    brands: f.category,
    _isCzech: true,
    serving_size: f.serving,
    portions: f.portions || null,
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
