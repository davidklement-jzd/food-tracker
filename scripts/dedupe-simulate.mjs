#!/usr/bin/env node
// Suchá simulace deduplikace.
// Pravidla:
//   A) Stejný normalizovaný název + stejný source + makra blízko (±15 %)
//      → ponech "nejlepší", zbytek drop.
//   B) Stejný normalizovaný název napříč zdroji + makra blízko:
//      → manual > usda > off. ALE: OFF s EAN se nikdy nemaže (potřebné pro barcode scan).
//   C) Rozdíl maker > 15 % → legit varianta, ponech vše.
//
// Skript NIC nemaže — jen reportuje.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const FILES = ['data/foods-cz.jsonl', 'data/off-cz.jsonl', 'data/fastfood-cz.jsonl'];
const PCT = 15;

const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[,()\-\/]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function loadAll() {
  const rows = [];
  for (const file of FILES) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
  }
  return rows;
}

function macrosClose(a, b, pct = PCT) {
  for (const f of ['kcal', 'protein', 'carbs', 'fat']) {
    const av = Number(a[f]), bv = Number(b[f]);
    if (!isFinite(av) || !isFinite(bv)) return false;
    const max = Math.max(Math.abs(av), Math.abs(bv));
    if (max < 0.5) continue;
    if (Math.abs(av - bv) / max * 100 > pct) return false;
  }
  return true;
}

function sourceRank(r) {
  if (r.source === 'manual') return 0;
  if (r.source === 'usda') return 1;
  if (r.source === 'off' && r.brand) return 2;
  return 3;
}

// Score: víc vyplněných polí = lepší
function completeness(r) {
  let s = 0;
  for (const f of ['fiber', 'sugar', 'salt', 'saturated_fat', 'brand', 'category', 'ean', 'default_grams', 'portions']) {
    if (r[f] != null && r[f] !== '') s++;
  }
  return s;
}

function pickWinner(items) {
  return items.slice().sort((a, b) => {
    const sr = sourceRank(a) - sourceRank(b);
    if (sr) return sr;
    const cd = completeness(b) - completeness(a);
    if (cd) return cd;
    return (a.id || '').length - (b.id || '').length;
  })[0];
}

const rows = await loadAll();
console.log(`loaded ${rows.length} rows\n`);

const groups = new Map();
for (const r of rows) {
  if (!r.title) continue;
  const k = norm(r.title);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

let totalRemoved = 0;
let groupsTouched = 0;
const removedBySource = { manual: 0, usda: 0, off: 0 };
const samplesA = [], samplesB = [], samplesKept = [];

for (const [key, items] of groups) {
  if (items.length < 2) continue;

  // shluky dle blízkosti maker
  const buckets = [];
  for (const it of items) {
    let placed = false;
    for (const b of buckets) {
      if (macrosClose(b[0], it)) { b.push(it); placed = true; break; }
    }
    if (!placed) buckets.push([it]);
  }

  for (const b of buckets) {
    if (b.length < 2) continue;
    const winner = pickWinner(b);
    // chráníme: OFF s EAN nikdy nemažeme (scannable produkt)
    const losers = b.filter(r => r !== winner && !(r.source === 'off' && r.ean));
    if (losers.length === 0) continue;
    groupsTouched++;
    for (const l of losers) {
      totalRemoved++;
      removedBySource[l.source] = (removedBySource[l.source] || 0) + 1;
    }

    // sample classification
    const sources = new Set(b.map(r => r.source));
    if (sources.size === 1 && samplesA.length < 8) {
      samplesA.push({ winner, losers });
    } else if (sources.size > 1 && samplesB.length < 8) {
      samplesB.push({ winner, losers });
    }
  }
}

console.log(`═══ SOUHRN ═══`);
console.log(`skupin k úpravě:    ${groupsTouched}`);
console.log(`řádků k odstranění: ${totalRemoved}`);
console.log(`  - usda:   ${removedBySource.usda || 0}`);
console.log(`  - off:    ${removedBySource.off || 0}`);
console.log(`  - manual: ${removedBySource.manual || 0}`);
console.log(`zůstane v DB:       ${rows.length - totalRemoved}\n`);

console.log(`═══ Pravidlo A — duplicita uvnitř stejného source (vzorek) ═══`);
for (const s of samplesA) {
  console.log(`✓ KEEP   [${s.winner.source}] ${s.winner.id} "${s.winner.title}" · ${s.winner.kcal}kcal`);
  for (const l of s.losers) {
    console.log(`✗ DROP   [${l.source}] ${l.id} "${l.title}" · ${l.kcal}kcal`);
  }
  console.log();
}

console.log(`═══ Pravidlo B — duplicita napříč zdroji (vzorek) ═══`);
for (const s of samplesB) {
  console.log(`✓ KEEP   [${s.winner.source}${s.winner.brand ? '+brand' : ''}] ${s.winner.id} "${s.winner.title}" · ${s.winner.kcal}kcal`);
  for (const l of s.losers) {
    console.log(`✗ DROP   [${l.source}${l.brand ? '+brand' : ''}] ${l.id} "${l.title}" · ${l.kcal}kcal`);
  }
  console.log();
}
