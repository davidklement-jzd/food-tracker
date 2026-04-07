#!/usr/bin/env node
// Vygeneruje konkrétní porce pro nelikvidní položky v Supabase tabulce `foods`.
// Použije Claude Haiku, vrací JSON pole {label, grams} jako pole 2-4 variant.
//
// Příklady výstupu:
//   "Tatranky"        → [{label:"1 oplatka", grams:25}, {label:"2 oplatky", grams:50}, {label:"Celé balení", grams:100}]
//   "Banán"           → [{label:"Malý banán", grams:90}, {label:"Banán", grams:120}, {label:"Velký banán", grams:160}]
//   "Kuřecí prsa"     → [{label:"Malá porce", grams:120}, {label:"Porce", grams:150}, {label:"Velká porce", grams:200}]
//   "Segedínský guláš"→ [{label:"Malá porce", grams:250}, {label:"Porce", grams:350}, {label:"Velká porce", grams:500}]
//
// AI nesahá na nutriční hodnoty.
//
// Vyžaduje:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/generate-portions-ai.mjs
//
// Volitelné flagy:
//   --limit=200    omezit počet zpracovaných položek
//   --source=off   filtrovat jen jeden source
//   --overwrite    přepsat i položky které už mají portions vyplněné

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);

const SOURCE = args.source || null;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const OVERWRITE = !!args.overwrite;
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

const SYSTEM = `Jsi expert na české potraviny. Pro každou položku vrať 2–4 reálné porce v gramech, jak se to v ČR opravdu jí. Cíl: aby si uživatel mohl vybrat z reálných variant, ne počítat gramy ručně.

Pravidla:
- Vždy vrať 2 až 4 varianty seřazené od nejmenší po největší.
- Každá porce má krátký label v češtině (max 20 znaků) a integer gramy.
- Použij KONKRÉTNÍ názvy podle typu produktu, ne generické "Malá/Normální/Velká":
  • počitatelné kusy: "1 plátek", "2 plátky", "1 kus", "1 oplatek", "1 banán", "1 vejce"
  • celé balení: "Celé balení", "Tabulka 100g"
  • porce jídla: "Porce", "Velká porce", "Polovina"
  • polévky: "Talíř (250 ml)", "Hlubší talíř (350 ml)"
- Pokud existuje typický gram balení (např. tatranky 47g, jogurt 150g, čokoláda 100g), zahrň ho.
- Generická "Malá/Normální/Velká porce" použij JEN když nic jiného nedává smysl (např. hovězí maso syrové).
- Odpověz POUZE čistým JSON objektem ve formátu:
  { "id1": [{"label":"1 plátek","grams":30},{"label":"2 plátky","grams":60}], "id2": null }
- Pokud netušíš nebo porce nedává smysl (koření, doplňky), vrať null pro daný id.
- ŽÁDNÝ markdown, ŽÁDNÉ komentáře, jen čistý JSON.`;

async function fetchTodo() {
  let query = supabase
    .from('foods')
    .select('id, title, brand, default_grams, portions')
    .eq('is_liquid', false)
    .not('default_grams', 'is', null);
  if (SOURCE) query = query.eq('source', SOURCE);
  if (!OVERWRITE) query = query.is('portions', null);

  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1).order('id');
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
  const userMsg = items.map((it) => {
    const hint = it.default_grams ? ` (typická porce ${it.default_grams}g)` : '';
    return `${it.id}: "${it.title}"${it.brand ? ` [${it.brand}]` : ''}${hint}`;
  }).join('\n');

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
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Vygeneruj porce pro tyto produkty:\n\n${userMsg}` }],
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

function validatePortions(p) {
  if (!Array.isArray(p) || p.length < 1 || p.length > 6) return null;
  const cleaned = [];
  for (const item of p) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim().slice(0, 30);
    const grams = Number(item.grams);
    if (!label || !Number.isFinite(grams) || grams < 1 || grams > 3000) continue;
    cleaned.push({ label, grams: Math.round(grams) });
  }
  if (cleaned.length === 0) return null;
  // Seřadit podle gramů
  cleaned.sort((a, b) => a.grams - b.grams);
  return cleaned;
}

async function updateBatch(updates) {
  for (const row of updates) {
    const { error } = await supabase
      .from('foods')
      .update({ portions: row.portions })
      .eq('id', row.id);
    if (error) console.error(`Update ${row.id} error:`, error.message);
  }
}

async function main() {
  console.log(`Načítám položky ze Supabase (is_liquid=false, default_grams not null${OVERWRITE ? '' : ', portions IS NULL'})…`);
  const todo = await fetchTodo();
  console.log(`K vygenerování porcí: ${todo.length} položek`);
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
      continue;
    }

    const updates = [];
    for (const item of batch) {
      const raw = result[item.id];
      const portions = validatePortions(raw);
      if (!portions) { nullCount++; continue; }
      updates.push({ id: item.id, portions });
    }
    await updateBatch(updates);
    updated += updates.length;

    const totalBatches = Math.ceil(todo.length / BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${currentBatch}/${totalBatches} – updated ${updates.length}/${batch.length} (celkem updated: ${updated}, null: ${nullCount})`);

    if (i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  console.log(`\nHotovo. Vygenerováno ${updated} sad porcí, ${nullCount} ponecháno bez porcí.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
