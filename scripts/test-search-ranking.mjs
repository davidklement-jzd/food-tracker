#!/usr/bin/env node
// Offline test rankingu pro search_foods.
// Načte JSONL data lokálně a simuluje skóre stejně jako migrace 013.
// Použití: node scripts/test-search-ranking.mjs [query1] [query2] ...

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const FILES = ['data/foods-cz.jsonl', 'data/off-cz.jsonl', 'data/fastfood-cz.jsonl'];

const DEFAULT_QUERIES = [
  'rohlík', 'jogurt', 'kuře', 'vejce', 'mléko',
  'mandlové mléko', 'banán', 'chléb', 'sýr', 'máslo',
  'tvaroh', 'rýže', 'kuřecí prsa', 'olivový olej',
];

async function loadAll() {
  const rows = [];
  for (const file of FILES) {
    try {
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch {}
      }
    } catch (e) {
      console.warn(`skip ${file}: ${e.message}`);
    }
  }
  return rows;
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// jednoduchý bigram Jaccard jako náhrada pg_trgm similarity
function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  const grams = s => {
    const padded = `  ${s} `;
    const set = new Set();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

function rank(rows, q) {
  const qn = norm(q);
  const scored = rows
    .map(f => {
      const tn = norm(f.title || '');
      const isSubstring = tn.includes(qn);
      const sim = similarity(f.title, q);
      if (!isSubstring && sim < 0.2) return null;
      const isExact = tn === qn;
      const isPrefix = tn.startsWith(qn);
      const commaCount = (f.title.match(/,/g) || []).length;
      const sourceRank =
        f.source === 'manual' ? 0 :
        f.source === 'usda' ? 1 :
        (f.source === 'off' && f.brand) ? 2 : 3;
      return { f, isExact, isPrefix, isSubstring, sim, commaCount, sourceRank };
    })
    .filter(Boolean);

  scored.sort((a, b) => {
    if (a.isPrefix !== b.isPrefix) return b.isPrefix - a.isPrefix;
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    if (a.isExact !== b.isExact) return b.isExact - a.isExact;
    if (a.isSubstring !== b.isSubstring) return b.isSubstring - a.isSubstring;
    if (b.sim !== a.sim) return b.sim - a.sim;
    if (a.commaCount !== b.commaCount) return a.commaCount - b.commaCount;
    if ((a.f.confidence || 99) !== (b.f.confidence || 99)) return (a.f.confidence || 99) - (b.f.confidence || 99);
    return (a.f.title.length - b.f.title.length);
  });
  return scored.slice(0, 5);
}

const rows = await loadAll();
console.log(`loaded ${rows.length} rows from ${FILES.length} files\n`);

const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_QUERIES;
for (const q of queries) {
  console.log(`── "${q}" ──`);
  const top = rank(rows, q);
  if (!top.length) { console.log('  (no results)'); continue; }
  for (const r of top) {
    const src = r.f.source === 'off' ? `off${r.f.brand ? '+brand' : ''}` : r.f.source;
    console.log(`  [${src}] ${r.f.title}${r.f.brand ? ` (${r.f.brand})` : ''}  · ${r.f.kcal}kcal`);
  }
  console.log();
}
