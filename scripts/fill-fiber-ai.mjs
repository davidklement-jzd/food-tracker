#!/usr/bin/env node
// Doplní `fiber` (vlákninu) k položkám v Supabase tabulce `foods`,
// které ji nemají vyplněnou (NULL). AI dostane název, kategorii a makra
// a odhadne realistické množství vlákniny v g / 100 g.
//
// Vyžaduje:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/fill-fiber-ai.mjs --dry-run
//   (poté bez --dry-run pro skutečný zápis)
//
// Volitelné argumenty:
//   --source=manual  (default) – jen produkty s tímto source (manual | off | usda | user | all)
//   --limit=1000     omezení počtu řádků zpracovaných v jednom běhu
//   --dry-run        vypíše navrhované hodnoty, ale do DB nezapíše
//   --mode=null      (default) zpracuje položky s fiber IS NULL
//   --mode=zero      zpracuje položky s fiber = 0 (oprava chybně zapsaných nul);
//                    do DB se zapíše jen pokud AI navrhne hodnotu > 0
//   --mode=both      obojí (NULL i 0)

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);

const SOURCE = args.source || 'manual';
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const DRY_RUN = !!args['dry-run'];
const MODE = args.mode || 'null'; // 'null' | 'zero' | 'both'
if (!['null', 'zero', 'both'].includes(MODE)) {
  console.error(`Neplatná hodnota --mode=${MODE}. Použij null, zero, nebo both.`);
  process.exit(1);
}
const BATCH_SIZE = 25;
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

const SYSTEM = `Jsi expert na výživu a české potraviny. Pro každou položku odhadni obsah VLÁKNINY v g / 100 g.
Pravidla:
- Vrať POUZE číslo v g / 100 g (např. 2.4, 6, 0).
- Pokud netušíš nebo by vláknina byla jen stopová, vrať 0.
- Orientační hodnoty (g/100g):
  - Maso (syrové i upravené), ryby, vejce, mléko, sýry, jogurty, smetana, máslo, oleje, cukr: 0
  - Zelenina syrová: rajče 1.2, okurka 0.5, mrkev 2.8, paprika 1.7, brokolice 2.6, květák 2.1, zelí 2.5, špenát 2.2, cibule 1.7, salát 1.3, dýně 1.1
  - Ovoce syrové: jablko 2.4, hruška 3.1, banán 2.6, jahoda 2, borůvky 2.4, pomeranč 2.4, hrozny 0.9, meloun 0.4, švestka 1.4
  - Pečivo: bílý chléb 2.7, žitný chléb 5.8, celozrnný 7, rohlík 3, knäckebrot 14, toastový chléb 2.5
  - Luštěniny vařené: čočka 8, fazole 7, cizrna 7, hrách 5
  - Obiloviny/přílohy vařené: rýže 0.4, těstoviny 1.8, bulgur 4.5, quinoa 2.8, pohanka 2.7, brambory 1.8
  - Obiloviny syrové: ovesné vločky 10, rýže syrová 1.3, těstoviny syrové 3
  - Ořechy, semínka: mandle 12, vlašské 7, lněné 27, chia 34, slunečnicové 8
  - Polévky: obvykle 1–2 (podle zeleniny)
  - Hotová jídla s přílohou/omáčkou: obvykle 1–3
  - Sladké pečivo, zákusky: 1–2
  - Čokoláda hořká 7, mléčná 2
  - Nápoje včetně mléka: 0 (džus s dužinou 0.5)
- Dívej se i na makra: pokud je produkt převážně cukr nebo tuk bez rostlinných složek, vláknina = 0.

Vrať POUZE čistý JSON objekt: { "id1": 2.4, "id2": 0, "id3": 7 }. Žádný markdown.`;

async function fetchTodo() {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('foods')
      .select('id, title, brand, category, kcal, protein, carbs, fat, fiber');
    if (SOURCE !== 'all') q = q.eq('source', SOURCE);
    if (MODE === 'null') q = q.is('fiber', null);
    else if (MODE === 'zero') q = q.eq('fiber', 0);
    else q = q.or('fiber.is.null,fiber.eq.0');
    q = q.order('id').range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    if (LIMIT && all.length >= LIMIT) break;
    from += PAGE;
  }
  return LIMIT ? all.slice(0, LIMIT) : all;
}

function formatItem(it) {
  const macros = `${it.kcal ?? '?'}kcal B${it.protein ?? '?'} S${it.carbs ?? '?'} T${it.fat ?? '?'}`;
  const brand = it.brand ? ` [${it.brand}]` : '';
  const cat = it.category ? ` (${it.category})` : '';
  return `${it.id}: "${it.title}"${cat}${brand} — ${macros}`;
}

async function callHaiku(items) {
  const userMsg = items.map(formatItem).join('\n');
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
        messages: [{ role: 'user', content: `Odhadni vlákninu (g/100g) pro tyto potraviny:\n\n${userMsg}` }],
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
  for (const row of updates) {
    const { error } = await supabase
      .from('foods')
      .update({ fiber: row.fiber })
      .eq('id', row.id);
    if (error) console.error(`Update ${row.id} error:`, error.message);
  }
}

async function main() {
  const filterDesc = MODE === 'null' ? 'fiber IS NULL' : MODE === 'zero' ? 'fiber = 0' : 'fiber IS NULL OR fiber = 0';
  console.log(`Načítám položky ze Supabase (source=${SOURCE}, ${filterDesc})${DRY_RUN ? ' [DRY RUN]' : ''}…`);
  const todo = await fetchTodo();
  console.log(`K doplnění: ${todo.length} položek`);
  if (todo.length === 0) {
    console.log('Nic k práci. Hotovo.');
    return;
  }

  let updated = 0;
  let skipped = 0;
  const dryRows = [];

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
      const raw = result[item.id];
      const num = typeof raw === 'number' ? raw : parseFloat(raw);
      if (Number.isNaN(num) || num < 0 || num > 60) {
        skipped++;
        continue;
      }
      const fiber = Math.round(num * 10) / 10;
      // V mode=zero/both: pokud položka už má 0 a AI taky vrací 0, neměníme.
      if (item.fiber === 0 && fiber === 0) {
        skipped++;
        continue;
      }
      updates.push({ id: item.id, fiber });
      if (DRY_RUN) dryRows.push({ title: item.title, category: item.category, fiber });
    }
    if (!DRY_RUN) await updateBatch(updates);
    updated += updates.length;

    const totalBatches = Math.ceil(todo.length / BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${currentBatch}/${totalBatches} – ${DRY_RUN ? 'proposed' : 'updated'} ${updates.length}/${batch.length} (celkem: ${updated}, přeskočeno: ${skipped})`);

    if (i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  if (DRY_RUN) {
    console.log('\n— DRY RUN výsledky —');
    for (const r of dryRows) console.log(`${r.fiber.toString().padStart(5)} g  ${r.category || ''}  ${r.title}`);
    console.log(`\nCelkem navrženo: ${updated} | přeskočeno: ${skipped}. Do DB nezapsáno.`);
  } else {
    console.log(`\nHotovo. Doplněno ${updated} vláknin, přeskočeno ${skipped}.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
