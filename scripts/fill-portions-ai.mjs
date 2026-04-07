#!/usr/bin/env node
// Doplní `default_grams` (typickou porci) k položkám v Supabase tabulce `foods`,
// které ji nemají vyplněnou. Pošle názvy přes Claude Haiku, který odhadne
// rozumnou porci podle typu produktu. AI nesahá na nutriční hodnoty.
//
// Vyžaduje:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/fill-portions-ai.mjs
//
// Volitelné argumenty:
//   --source=off    (default) – jen produkty s tímto source
//   --limit=1000    omezení počtu řádků zpracovaných v jednom běhu (pro testování)

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);

const SOURCE = args.source || 'off';
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const BATCH_SIZE = 30;
const DELAY_MS = 6000;
const MAX_RETRIES = 5;
const MODEL = 'claude-haiku-4-5-20251001';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `Jsi expert na české potraviny. Pro každou položku odhadni typickou porci v GRAMECH, jak se reálně jí v ČR.
Pravidla:
- Vrať POUZE číslo (gramy) nebo null pokud netušíš nebo by porce nedávala smysl.
- Reálné typické porce: jogurt 150, tatranka 25, plátek šunky 30, rohlík 50, hotové jídlo 350, polévka 250, čokoláda 30, oplatek 30, müsli 50, sušenka 20, sýr 30, pomazánka 20, nápoj 250.
- Pro hotová jídla (segedín, guláš, svíčková, polévky) vrať gramáž normální porce ne celého balení.
- Pro nápoje vrať ml jako gramy.
- Pro koření, ochucovadla, doplňky vrať null (porce nedává smysl).

Vrať POUZE čistý JSON objekt: { "id1": 150, "id2": null, ... }. Žádný markdown.`;

async function fetchTodo() {
  let query = supabase
    .from('foods')
    .select('id, title, brand, category')
    .eq('source', SOURCE)
    .is('default_grams', null)
    .order('id');
  if (LIMIT) query = query.limit(LIMIT);
  // Supabase má limit 1000 per dotaz – paginujeme
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    if (LIMIT && all.length >= LIMIT) break;
    from += PAGE;
  }
  return LIMIT ? all.slice(0, LIMIT) : all;
}

async function callHaiku(items) {
  const userMsg = items.map((it) => `${it.id}: "${it.title}"${it.brand ? ` [${it.brand}]` : ''}`).join('\n');
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Odhadni porce pro tyto produkty:\n\n${userMsg}` }],
      }),
    });
    if (res.status === 429 || res.status === 529) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 5000 * Math.pow(2, attempt - 1));
      console.log(`  ⏳ ${res.status} rate limit, čekám ${Math.round(waitMs / 1000)}s (pokus ${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error('Vyčerpány retry');
}

async function updateBatch(updates) {
  // Supabase nepodporuje bulk UPDATE různými hodnotami v jednom requestu,
  // ale upsert s celým tělem řádku ano. Stačí poslat id + default_grams.
  const rows = updates.map(({ id, default_grams }) => ({ id, default_grams }));
  // Použijeme update přes RPC by bylo lepší, ale stačí po jednom (rychlé i tak)
  for (const row of rows) {
    const { error } = await supabase
      .from('foods')
      .update({ default_grams: row.default_grams })
      .eq('id', row.id);
    if (error) console.error(`Update ${row.id} error:`, error.message);
  }
}

async function main() {
  console.log(`Načítám položky ze Supabase (source=${SOURCE}, default_grams IS NULL)…`);
  const todo = await fetchTodo();
  console.log(`K doplnění: ${todo.length} položek`);
  if (todo.length === 0) {
    console.log('Nic k práci. Hotovo.');
    return;
  }

  let updated = 0;
  let nullCount = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    let result;
    try {
      result = await callHaiku(batch);
    } catch (err) {
      console.error(`Batch ${i}–${i + batch.length} chyba:`, err.message);
      console.error('Pokračuji…');
      continue;
    }

    const updates = [];
    for (const item of batch) {
      const grams = result[item.id];
      if (grams == null || typeof grams !== 'number' || grams < 1 || grams > 2000) {
        nullCount++;
        continue;
      }
      updates.push({ id: item.id, default_grams: grams });
    }
    await updateBatch(updates);
    updated += updates.length;

    const totalBatches = Math.ceil(todo.length / BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${currentBatch}/${totalBatches} – updated ${updates.length}/${batch.length} (celkem updated: ${updated}, null: ${nullCount})`);

    if (i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  console.log(`\nHotovo. Doplněno ${updated} porcí, ${nullCount} ponecháno bez porce (Haiku netušil).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
