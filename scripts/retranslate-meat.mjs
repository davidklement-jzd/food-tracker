#!/usr/bin/env node
// Re-translate USDA mas s anglickými termíny (steak, loin, ribeye, …) do češtiny.
// Filtruje data/foods-cz.jsonl, posílá dávky do Claude Haiku, vygeneruje
// tmp/retranslate-meat.sql a přepíše data/foods-cz.jsonl.
//
// Vyžaduje: ANTHROPIC_API_KEY
// Použití:  ANTHROPIC_API_KEY=... node scripts/retranslate-meat.mjs
//           --dry  → jen ukáže návrhy, nic nepíše

import { createReadStream, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TARGET = 'data/foods-cz.jsonl';
const MODEL = 'claude-haiku-4-5-20251001';
const BATCH = 30;
const DELAY_MS = 1500;
const DRY = process.argv.includes('--dry');

const FILTER = /steak|loin|ribeye|tenderloin|sirloin|flank|brisket|chuck|round roast|short ribs|porterhouse|t-bone|rib roast/i;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY && !DRY) {
  console.error('Missing ANTHROPIC_API_KEY (nebo použij --dry)');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SYSTEM = `Jsi překladatel USDA názvů masa do přirozené češtiny pro fitness aplikaci.
Pravidla:
- Krátký, přirozený český název (max 5 slov, ideálně 3–4).
- BEZ čárek, BEZ anglických slov, BEZ markdownu.
- Zachovej stav (syrové/vařené/pečené/grilované/dušené/uzené).
- Použij běžné české kuchařské termíny: roštěnec, svíčková, kýta, plec, krk, žebro, hrudí, krční hřbet, vysoký roštěnec, nízký roštěnec, květová špička.
- Mapování: top loin → vysoký roštěnec; tenderloin → svíčková; ribeye → vysoký roštěnec; sirloin → nízký roštěnec; round → kýta; chuck → krk/plec; brisket → hrudí; flank → bok; rump → květová špička.
- Začni vždy druhem masa: "Hovězí ...", "Vepřové ...", "Kuřecí ...", "Jehněčí ..."

Vrať POUZE JSON pole {"id":"...", "title":"..."} ve stejném pořadí. Žádný markdown.`;

async function translateBatch(items) {
  const userMsg = items.map((it, i) => `${i + 1}. [${it.id}] "${it.title}"`).join('\n');
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Přelož ${items.length} názvů. Vrať JSON pole:\n\n${userMsg}` }],
      }),
    });
    if (res.status === 429 || res.status === 529) {
      const wait = Math.min(60000, 5000 * Math.pow(2, attempt - 1));
      console.log(`  ⏳ rate limit, čekám ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '[]';
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error('rate limit retries vyčerpány');
}

// Načti
const lines = [];
const rl = createInterface({ input: createReadStream(TARGET), crlfDelay: Infinity });
for await (const line of rl) lines.push(line);

const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
const todo = records.filter(r => r && FILTER.test(r.title));
console.log(`celkem řádků: ${records.length}`);
console.log(`k překladu:   ${todo.length}`);

if (DRY) {
  console.log('\nvzorek (prvních 10):');
  for (const r of todo.slice(0, 10)) console.log(`  [${r.id}] ${r.title}`);
  process.exit(0);
}

const updates = new Map(); // id → newTitle
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  console.log(`batch ${i / BATCH + 1}/${Math.ceil(todo.length / BATCH)} (${batch.length})`);
  try {
    const res = await translateBatch(batch);
    for (const item of res) {
      if (item.id && item.title) updates.set(item.id, item.title.trim());
    }
  } catch (e) {
    console.error('  err:', e.message, '— skip');
  }
  await sleep(DELAY_MS);
}

console.log(`\npřeloženo: ${updates.size}/${todo.length}`);

// SQL
mkdirSync('tmp', { recursive: true });
const sql = ['-- Re-translation USDA masa (Fáze 3, krok 2)', `-- Změn: ${updates.size}`, 'begin;'];
for (const [id, t] of updates) {
  sql.push(`update public.foods set title = '${t.replace(/'/g, "''")}' where id = '${id.replace(/'/g, "''")}';`);
}
sql.push('commit;');
writeFileSync('tmp/retranslate-meat.sql', sql.join('\n') + '\n');
console.log('wrote tmp/retranslate-meat.sql');

// JSONL přepis
const newLines = records.map((r, i) => {
  if (!r) return lines[i];
  if (updates.has(r.id)) return JSON.stringify({ ...r, title: updates.get(r.id) });
  return lines[i];
});
const tmp = TARGET + '.tmp';
writeFileSync(tmp, newLines.join('\n') + '\n');
renameSync(tmp, TARGET);
console.log(`rewrote ${TARGET}`);
