#!/usr/bin/env node
// Nahraje JSONL soubor s potravinami do Supabase tabulky `foods`.
// Akceptuje libovolný JSONL kde každý řádek = jeden record kompatibilní se schématem.
//
// Vyžaduje:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-foods-to-supabase.mjs data/foods-cz.jsonl

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const IN_FILE = process.argv[2] || 'data/foods-cz.jsonl';
const BATCH_SIZE = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function flush(batch) {
  if (batch.length === 0) return;
  // Dedupe by id within batch (poslední výskyt vyhrává)
  const map = new Map();
  for (const item of batch) map.set(item.id, item);
  const deduped = Array.from(map.values());
  const { error } = await supabase.from('foods').upsert(deduped, { onConflict: 'id' });
  if (error) {
    console.error('Upsert error:', error.message);
    throw error;
  }
}

async function main() {
  console.log(`Importing from ${IN_FILE}…`);
  const rl = createInterface({ input: createReadStream(IN_FILE), crlfDelay: Infinity });
  let batch = [];
  let total = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (!obj.id || !obj.title) continue;
    batch.push(obj);
    if (batch.length >= BATCH_SIZE) {
      await flush(batch);
      total += batch.length;
      console.log(`Imported ${total}…`);
      batch = [];
    }
  }
  await flush(batch);
  total += batch.length;
  console.log(`Done. ${total} items in Supabase.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
