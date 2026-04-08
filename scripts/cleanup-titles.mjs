#!/usr/bin/env node
// Heuristický cleanup českých titulů v foods-cz.jsonl.
// Bezpečné transformace bez AI:
//   - ", raw" → " syrové" (i ' raw' isolated)
//   - odstranění zbytečných čárek mezi názvem a přídavným jménem ("Vejce, sušené" → "Vejce sušené")
//   - typy: "slaené" → "slané", duplicitní mezery, trailing comma
//   - normalizace ", bez soli" → " bez soli"
//
// Vypisuje SQL UPDATE patches do tmp/cleanup-titles.sql a přepisuje JSONL.
// Před kažou změnou ukáže vzorek (--dry).

import { createReadStream, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TARGET = 'data/foods-cz.jsonl';
const DRY = process.argv.includes('--dry');

// Krok 1: typy (žádné \b — JS \b nefunguje s diakritikou)
const typoRules = [
  [/slaené/g, 'slané'],
  [/nízkotukem/g, 'nízkotučné'],
  [/syré/g, 'syrové'],
  [/nesláné/g, 'neslané'],
];

// Krok 2: anglické sloveso → české přídavné jméno (mapa)
// Hodnota je BÁZE (mužský rod -ý), gender se dovodí podle podstatného jména.
const enToCzBase = {
  raw: 'syrov',
  cooked: 'vařen',
  boiled: 'vařen',
  roasted: 'pečen',
  baked: 'pečen',
  grilled: 'grilovan',
  broiled: 'grilovan',
  braised: 'dušen',
  steamed: 'dušen',
  fried: 'smažen',
  frozen: 'zmrazen',
  canned: 'konzervovan',
  dried: 'sušen',
  smoked: 'uzen',
  fresh: 'čerstv',
  salted: 'slan',
  unsalted: 'neslan',
};

// Heuristika rodu/čísla podle posledního substantiva v titulu (před aktuální čárkou).
// Ne dokonalé, ale pokrývá 90 % případů.
function inferEnding(noun) {
  const w = (noun || '').toLowerCase();
  if (!w) return 'é';
  // plurály typu fazolky, srdce, kuřata → -é
  if (/(ky|ce|ata)$/.test(w)) return 'é';
  // singulár
  if (/a$/.test(w)) return 'á';        // meruňka, paprika
  if (/[oeěí]$/.test(w)) return 'é';   // mléko, vejce, maso, kuře
  // konsonant → mužský rod
  return 'ý';                          // banán, sýr, chléb
}

function findHeadNoun(prefix) {
  // První slovo, které není přídavné jméno (-ý/-á/-é/-í) ani číslo.
  // "Hovězí mleté maso" → "maso", "Banán zralý" → "Banán", "Jablko Fuji" → "Jablko".
  const words = prefix.trim().replace(/,/g, '').split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (/^[\d%]/.test(w)) continue;
    if (/[ýáéíÝÁÉÍ]$/.test(w)) continue; // přídavné jméno (pozor na diakritiku!)
    return w;
  }
  return words[0] || '';
}

// nahradí anglické slovo (kdekoliv) za rodově správný český překlad
function translateEnWord(title) {
  for (const [en, base] of Object.entries(enToCzBase)) {
    const re = new RegExp(`(^|[\\s,])${en}\\b`, 'gi');
    title = title.replace(re, (m, sep, offset) => {
      const prefix = title.slice(0, offset);
      const noun = findHeadNoun(prefix);
      const end = inferEnding(noun);
      return `${sep === ',' ? '' : sep}${base}${end}`;
    });
  }
  return title;
}

function dropStrayCommas(title) {
  // odstraň všechny ", " uvnitř titulu (bezpečné: většinou jen oddělovač USDA stylu)
  return title.replace(/,\s*/g, ' ');
}

function clean(t) {
  let out = t;
  for (const [re, rep] of typoRules) out = out.replace(re, rep);
  out = translateEnWord(out);
  out = dropStrayCommas(out);
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+$/g, '').replace(/^\s+/g, '');
  return out;
}

const rl = createInterface({ input: createReadStream(TARGET), crlfDelay: Infinity });
const updates = []; // {id, oldTitle, newTitle, line}
const newLines = [];
for await (const line of rl) {
  if (!line.trim()) { newLines.push(line); continue; }
  let obj;
  try { obj = JSON.parse(line); } catch { newLines.push(line); continue; }
  const oldTitle = obj.title || '';
  const newTitle = clean(oldTitle);
  if (newTitle !== oldTitle) {
    updates.push({ id: obj.id, oldTitle, newTitle });
    obj.title = newTitle;
    newLines.push(JSON.stringify(obj));
  } else {
    newLines.push(line);
  }
}

console.log(`změn: ${updates.length} / ${newLines.length}`);
console.log(`\nvzorek:`);
for (const u of updates.slice(0, 20)) {
  console.log(`  "${u.oldTitle}"`);
  console.log(`→ "${u.newTitle}"`);
}

if (DRY) {
  console.log('\n(--dry: nic se nezapsalo)');
  process.exit(0);
}

// SQL patch
mkdirSync('tmp', { recursive: true });
const sql = ['-- Cleanup českých titulů (Fáze 3, krok 1)', `-- Změn: ${updates.length}`, 'begin;'];
for (const u of updates) {
  const id = u.id.replace(/'/g, "''");
  const t = u.newTitle.replace(/'/g, "''");
  sql.push(`update public.foods set title = '${t}' where id = '${id}';`);
}
sql.push('commit;');
writeFileSync('tmp/cleanup-titles.sql', sql.join('\n') + '\n');
console.log(`\nwrote tmp/cleanup-titles.sql (${updates.length} updates)`);

// přepis JSONL
const tmp = TARGET + '.tmp';
writeFileSync(tmp, newLines.join('\n') + '\n');
renameSync(tmp, TARGET);
console.log(`rewrote ${TARGET}`);
