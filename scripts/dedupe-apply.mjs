#!/usr/bin/env node
// Aplikuje deduplikaci:
//   - vygeneruje SQL DELETE pro Supabase  → tmp/dedupe-delete.sql
//   - přepíše data/foods-cz.jsonl bez odstraněných USDA řádků (atomicky přes .tmp)
//
// Pravidla viz dedupe-simulate.mjs (chrání OFF s EAN).

import { createReadStream, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';

const FILES = ['data/foods-cz.jsonl', 'data/off-cz.jsonl', 'data/fastfood-cz.jsonl'];
const PCT = 15;

const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[,()\-\/]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function loadFile(file) {
  const out = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { out.push({ raw: line, obj: JSON.parse(line) }); } catch {}
  }
  return out;
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

// Načti všechny soubory zvlášť, ať můžeme přepsat foods-cz.jsonl
const fileData = {};
for (const f of FILES) fileData[f] = await loadFile(f);

const all = [];
for (const f of FILES) for (const e of fileData[f]) all.push({ file: f, ...e });

console.log(`loaded ${all.length} rows`);

const groups = new Map();
for (const e of all) {
  const t = e.obj.title;
  if (!t) continue;
  const k = norm(t);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(e);
}

const toDeleteIds = new Set();
for (const [, entries] of groups) {
  if (entries.length < 2) continue;
  const buckets = [];
  for (const e of entries) {
    let placed = false;
    for (const b of buckets) {
      if (macrosClose(b[0].obj, e.obj)) { b.push(e); placed = true; break; }
    }
    if (!placed) buckets.push([e]);
  }
  for (const b of buckets) {
    if (b.length < 2) continue;
    const winner = pickWinner(b.map(x => x.obj));
    for (const e of b) {
      if (e.obj === winner) continue;
      if (e.obj.source === 'off' && e.obj.ean) continue; // chráníme OFF s EAN
      toDeleteIds.add(e.obj.id);
    }
  }
}

console.log(`to delete: ${toDeleteIds.size} rows`);

// 1) SQL DELETE
mkdirSync('tmp', { recursive: true });
const ids = [...toDeleteIds];
const sqlLines = [];
sqlLines.push('-- Deduplikace foods (Fáze 2). Bezpečné: žádný OFF s EAN.');
sqlLines.push(`-- Celkem: ${ids.length} řádků`);
sqlLines.push('begin;');
const CHUNK = 500;
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK).map(id => `'${id.replace(/'/g, "''")}'`).join(',');
  sqlLines.push(`delete from public.foods where id in (${chunk});`);
}
sqlLines.push('commit;');
writeFileSync('tmp/dedupe-delete.sql', sqlLines.join('\n') + '\n');
console.log('wrote tmp/dedupe-delete.sql');

// 2) Přepiš data/foods-cz.jsonl bez smazaných řádků
const target = 'data/foods-cz.jsonl';
const kept = fileData[target].filter(e => !toDeleteIds.has(e.obj.id));
const removed = fileData[target].length - kept.length;
const tmp = target + '.tmp';
writeFileSync(tmp, kept.map(e => e.raw).join('\n') + '\n');
renameSync(tmp, target);
console.log(`rewrote ${target}: ${fileData[target].length} → ${kept.length} (removed ${removed})`);
