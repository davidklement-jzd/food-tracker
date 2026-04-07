#!/usr/bin/env node
// Vezme data/usda-foods.jsonl, přeloží anglické názvy a kategorie do češtiny
// pomocí Claude Haiku, doplní typickou porci v gramech, a uloží jako
// data/foods-cz.jsonl připravený k importu do Supabase.
//
// AI dělá JEN překlad a odhad porce — nutriční hodnoty zůstávají nedotčené
// (USDA data jsou faktická, nesahat).
//
// Vyžaduje:
//   ANTHROPIC_API_KEY
//
// Použití:
//   ANTHROPIC_API_KEY=... node scripts/translate-foods-to-czech.mjs
//
// Resumable: pokud script přerušíš, příště pokračuje od poslední přeložené položky.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const IN_FILE = 'data/usda-foods.jsonl';
const OUT_FILE = 'data/foods-cz.jsonl';
const STATE_FILE = 'data/foods-cz.state.json';
const BATCH_SIZE = 25;
const MODEL = 'claude-haiku-4-5-20251001';
const DELAY_BETWEEN_BATCHES_MS = 6000; // ~10 batchů/min, pod 10k OPM limit
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY env var.');
  process.exit(1);
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return { processedIds: [] };
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}
async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify({ processedIds: state.processedIds }, null, 2));
}

const SYSTEM = `Jsi překladatel anglických názvů potravin (USDA databáze) do češtiny pro fitness aplikaci.
Pro každou položku vrať:
- title_cs: krátký český název (jak by ho napsala česká klientka, max 60 znaků). Bez "USDA" nebo nadbytečných detailů. Pokud je v anglickém názvu uvedený stav (raw, cooked, boiled, fried), zahrň ho.
- category_cs: jedna z následujících kategorií (přesně tak jak jsou napsané): Maso, Ryby, Mléčné, Vejce, Pečivo, Obiloviny, Přílohy, Zelenina, Ovoce, Luštěniny, Ořechy, Tuky, Sladkosti, Nápoje, Koření, Jiné
- default_grams: typická porce v gramech, jak se reálně jí v ČR. Číslo nebo null pokud netušíš. Příklady: kuřecí prsa 150, banán 120, jogurt 150, plátek šunky 30, vejce 60, lžíce oleje 10.
- skip: true, pokud položka nedává smysl pro českou fitness app (např. extrémně specifické americké produkty, syrové vnitřnosti, nesmyslné kombinace). Jinak false.

Vrátíš POUZE čistý JSON pole, žádný markdown ani komentáře.`;

async function translateBatch(items) {
  const userMsg = items.map((it, i) => `${i + 1}. [${it.id}] "${it.title_en}" (kategorie: ${it.category_en || 'n/a'})`).join('\n');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Přelož těchto ${items.length} potravin. Vrať JSON pole se stejným pořadím a id:\n\n${userMsg}` }],
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
    const text = data.content?.[0]?.text || '[]';
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error(`Vyčerpány retry po ${MAX_RETRIES} pokusech (rate limit).`);
}

async function main() {
  await mkdir('data', { recursive: true });
  const state = await loadState();
  const processed = new Set(state.processedIds);
  console.log(`Resuming. Already processed: ${processed.size}`);

  // Načti všechny USDA položky do paměti (~7800, malé)
  const all = [];
  const rl = createInterface({ input: createReadStream(IN_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    all.push(JSON.parse(line));
  }
  console.log(`Loaded ${all.length} USDA items.`);

  const todo = all.filter((it) => !processed.has(it.id));
  console.log(`To translate: ${todo.length}`);

  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    let translations;
    try {
      translations = await translateBatch(batch);
    } catch (err) {
      console.error(`Batch ${i}–${i + batch.length} error:`, err.message);
      console.error('Skipping batch and continuing…');
      continue;
    }

    // Sestavíme finální záznamy
    const merged = [];
    for (const tr of translations) {
      if (tr.skip) continue;
      const src = batch.find((b) => b.id === tr.id);
      if (!src) continue;
      merged.push({
        id: src.id,
        title: tr.title_cs,
        slug: null,
        kcal: src.kcal,
        protein: src.protein,
        carbs: src.carbs,
        fat: src.fat,
        fiber: src.fiber,
        sugar: src.sugar,
        salt: src.salt,
        saturated_fat: src.saturated_fat,
        category: tr.category_cs || null,
        brand: null,
        ean: null,
        default_grams: tr.default_grams || null,
        portions: null,
        source: 'usda',
        confidence: 2,
        raw: { fdcId: src.fdcId, dataType: src.dataType, title_en: src.title_en, category_en: src.category_en },
      });
    }

    if (merged.length > 0) {
      await appendFile(OUT_FILE, merged.map((m) => JSON.stringify(m)).join('\n') + '\n');
    }
    for (const b of batch) state.processedIds.push(b.id);
    processed.add(...batch.map((b) => b.id));
    await saveState(state);

    console.log(`Batch ${i / BATCH_SIZE + 1}/${Math.ceil(todo.length / BATCH_SIZE)} – translated ${merged.length}/${batch.length}`);
    if (i + BATCH_SIZE < todo.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log(`\nDone. Output: ${OUT_FILE}`);
  console.log(`Approx cost: input ~${inputTokens} tok, output ~${outputTokens} tok`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
