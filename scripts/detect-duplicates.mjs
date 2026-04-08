#!/usr/bin/env node
// Offline detekce duplicit v JSONL souborech.
// Skupiny podle normalizovaného titulu, rozdělené na "strict dup" (skoro stejná makra)
// a "variant" (legit rozdílné varianty).
//
// Použití: node scripts/detect-duplicates.mjs

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const FILES = ['data/foods-cz.jsonl', 'data/off-cz.jsonl', 'data/fastfood-cz.jsonl'];

const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[,()\-\/]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function loadAll() {
  const rows = [];
  for (const file of FILES) {
    try {
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch {}
      }
    } catch (e) { console.warn(`skip ${file}: ${e.message}`); }
  }
  return rows;
}

// strict dup: makra se liší max o pct% (na bázi vyšší hodnoty)
function macrosClose(a, b, pct = 5) {
  const fields = ['kcal', 'protein', 'carbs', 'fat'];
  for (const f of fields) {
    const av = Number(a[f]), bv = Number(b[f]);
    if (!isFinite(av) || !isFinite(bv)) return false;
    const max = Math.max(Math.abs(av), Math.abs(bv));
    if (max < 0.5) continue; // oba ~0
    if (Math.abs(av - bv) / max * 100 > pct) return false;
  }
  return true;
}

const rows = await loadAll();
console.log(`loaded ${rows.length} rows\n`);

// group by normalized title
const groups = new Map();
for (const r of rows) {
  if (!r.title) continue;
  const k = norm(r.title);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

let dupGroups = 0, dupRows = 0, variantGroups = 0, variantRows = 0;
const dupSamples = [];
const variantSamples = [];

for (const [key, items] of groups) {
  if (items.length < 2) continue;

  // rozdělit na podskupiny s blízkými makry
  const buckets = [];
  for (const it of items) {
    let placed = false;
    for (const b of buckets) {
      if (macrosClose(b[0], it)) { b.push(it); placed = true; break; }
    }
    if (!placed) buckets.push([it]);
  }

  // strict dup buckety (>=2 položky s blízkými makry)
  const strict = buckets.filter(b => b.length >= 2);
  if (strict.length) {
    for (const b of strict) {
      dupGroups++;
      dupRows += b.length - 1; // kolik by zmizelo
      if (dupSamples.length < 10) dupSamples.push(b);
    }
  }

  // legit varianty: stejný klíč ale různé buckety (různá makra)
  if (buckets.length >= 2) {
    variantGroups++;
    variantRows += items.length;
    if (variantSamples.length < 10) variantSamples.push({ key, items });
  }
}

console.log('═══ STRICT DUPLICITY (stejný název + makra ±5%) ═══');
console.log(`skupin: ${dupGroups}, řádků k odstranění: ${dupRows}\n`);
for (const b of dupSamples) {
  console.log(`• "${b[0].title}" — ${b.length}×`);
  for (const r of b) {
    console.log(`    [${r.source}${r.brand ? '+brand' : ''}] ${r.id} · ${r.kcal}kcal P${r.protein} C${r.carbs} F${r.fat}`);
  }
}

console.log('\n═══ LEGIT VARIANTY (stejný název, různá makra) ═══');
console.log(`skupin: ${variantGroups}, celkem řádků: ${variantRows}\n`);
for (const v of variantSamples) {
  console.log(`• "${v.key}" — ${v.items.length}×`);
  for (const r of v.items.slice(0, 4)) {
    console.log(`    [${r.source}${r.brand ? '+brand' : ''}] "${r.title}" · ${r.kcal}kcal P${r.protein} C${r.carbs} F${r.fat}`);
  }
  if (v.items.length > 4) console.log(`    ... a další ${v.items.length - 4}`);
}
