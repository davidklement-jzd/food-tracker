#!/usr/bin/env node
// Doplní vlákninu (`fiber`) ve `diary_entries`, kde je 0, ale spárovaná
// potravina v `foods` má vlákninu > 0. Přepisuje jen 0 → kladná hodnota,
// nikdy nezahodí ručně zapsanou nenulovou hodnotu.
//
// Vyžaduje:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Použití:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backfill-entry-fiber.mjs --dry-run
//   (poté bez --dry-run pro skutečný zápis)
//
// Volitelné argumenty:
//   --match=id        (default) matchuje jen entries s vyplněným food_id
//   --match=name      matchuje entries BEZ food_id přes shodu name+brand;
//                     spáruje jen pokud je v foods PRÁVĚ JEDEN match (jednoznačnost)
//   --match=curated   kurátorovaný fallback: hardcoded fiber pro nejběžnější
//                     české potraviny (rajče, okurka, paprika, ovoce, kaše…).
//                     Aplikuje se na entries s fiber=0 bez ohledu na food_id.
//                     Použít, když číselník foods má fiber=0 i tam, kde nemá.
//   --match=all       id + name + curated v jednom běhu
//   --fix-foods       projde tabulku foods, kde je fiber NULL nebo 0, a aplikuje
//                     stejné kurátorované hodnoty (g/100g) na řádky shodující se
//                     s pravidly podle title. Tím se opraví číselník i pro
//                     budoucí zápisy. Lze kombinovat s libovolným --match.

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);
const DRY_RUN = !!args['dry-run'];
const MATCH = args.match || 'id'; // 'id' | 'name' | 'curated' | 'both' | 'all'
if (!['id', 'name', 'curated', 'both', 'all'].includes(MATCH)) {
  console.error(`Neplatná hodnota --match=${MATCH}. Použij id, name, curated, both, nebo all.`);
  process.exit(1);
}
const FIX_FOODS = !!args['fix-foods'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function fetchEntriesNeedingFiber({ withFoodId }) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from('diary_entries')
      .select('id, name, brand, grams, fiber, food_id')
      .eq('fiber', 0);
    q = withFoodId ? q.not('food_id', 'is', null) : q.is('food_id', null);
    q = q.order('id').range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/\s+/g, ' ')
    .trim();
}

// Kurátorovaný seznam vlákniny v g / 100 g pro nejběžnější české potraviny.
// Každé pravidlo: { match: regex (na normalizovaném názvu), fiber: g/100g, label }.
// Pravidla aplikujeme v pořadí — první shoda vyhrává. Pořadí je důležité —
// specifičtější pravidla musí být PŘED obecnějšími (např. "salát caesar" před "salat").
const CURATED_FIBER = [
  // Salátové výjimky (nejdřív, ať obecné /salat/ je nepřekryje)
  { match: /\bsalat\s+caesar\b/, fiber: 1.5, label: 'salát caesar' },
  { match: /\bsalat\s+(s\s+|z\s+|nicoise|coleslaw)/, fiber: 2.0, label: 'salát (smíchaný)' },

  // Zelenina syrová (per fill-fiber-ai orientace)
  { match: /\brajc[a-z]*\b/, fiber: 1.2, label: 'rajče' }, // rajče, rajčata, rajčátka, rajčátko, rajčový
  { match: /\bcherry\s*rajc[a-z]*\b/, fiber: 1.2, label: 'cherry rajče' },
  { match: /\bokurk(a|y|ova|ovy)\s*(saladova|salatova|hadovka|kysla|nakladana|syrova|cely)?\b/, fiber: 0.5, label: 'okurka' },
  { match: /\bpaprik(a|y|ovy|ova)\s*(cervena|zelena|zluta|kapie|babura|syrova)?\b/, fiber: 1.7, label: 'paprika' },
  { match: /\bmrkev|mrkve\b/, fiber: 2.8, label: 'mrkev' },
  { match: /\bbrokolic(e|ova)\b/, fiber: 2.6, label: 'brokolice' },
  { match: /\bkvetak\b/, fiber: 2.1, label: 'květák' },
  { match: /\bzeli\s*(bile|cervene|cervenne|hlavkove|kysane)?\b/, fiber: 2.5, label: 'zelí' },
  { match: /\bspenat\s*(listovy|cerstvy|mrazeny)?\b/, fiber: 2.2, label: 'špenát' },
  { match: /\bcibul(e|ovy)\b/, fiber: 1.7, label: 'cibule' },
  { match: /\bcesnek\b/, fiber: 2.1, label: 'česnek' },
  { match: /\b(hlavkov[ya]?\s+)?salat\s*(ledov[ya]|hlavkov[ya]|romsk[ya]|listovy)?\b/, fiber: 1.3, label: 'salát listový' },
  { match: /\brukol(a|ova)\b/, fiber: 1.6, label: 'rukola' },
  { match: /\bredkvic(ka|ky|kov[ya])\b/, fiber: 1.6, label: 'ředkvička' },
  { match: /\bdyne\b/, fiber: 1.1, label: 'dýně' },
  { match: /\bcuketa|cukety\b/, fiber: 1.1, label: 'cuketa' },
  { match: /\blilek\b/, fiber: 3.0, label: 'lilek' },
  { match: /\bkukurice\b/, fiber: 2.7, label: 'kukuřice' },
  { match: /\bhrasek\s*(zeleny|mrazeny)?\b/, fiber: 5.5, label: 'hrášek' },

  // Ovoce
  { match: /\bjablk(o|a|ove)\b/, fiber: 2.4, label: 'jablko' },
  { match: /\bhrusk(a|y|ove)\b/, fiber: 3.1, label: 'hruška' },
  { match: /\bbanan\b/, fiber: 2.6, label: 'banán' },
  { match: /\bjahod(y|ove)\b/, fiber: 2.0, label: 'jahody' },
  { match: /\bborůvk[ya]|boruvk[ya]\b/, fiber: 2.4, label: 'borůvky' },
  { match: /\bmaliny|maliniky\b/, fiber: 6.5, label: 'maliny' },
  { match: /\bostruziny\b/, fiber: 5.3, label: 'ostružiny' },
  { match: /\bpomeranc\b/, fiber: 2.4, label: 'pomeranč' },
  { match: /\bmandarink[ya]\b/, fiber: 1.8, label: 'mandarinka' },
  { match: /\bgrep|grapefruit\b/, fiber: 1.6, label: 'grep' },
  { match: /\bhroznov[ye]?\s*vino|hrozny\b/, fiber: 0.9, label: 'hroznové víno' },
  { match: /\bmelou?n\b/, fiber: 0.4, label: 'meloun' },
  { match: /\bbroskev|nektarink[ya]\b/, fiber: 1.5, label: 'broskev' },
  { match: /\bmerunk[ya]\b/, fiber: 2.0, label: 'meruňka' },
  { match: /\bsvestk[ya]\b/, fiber: 1.4, label: 'švestka' },
  { match: /\bkivi\b/, fiber: 3.0, label: 'kiwi' },
  { match: /\bananas\b/, fiber: 1.4, label: 'ananas' },

  // Pečivo — tmavé (žitné, celozrnné, grahamové, špaldové) — modifier v JAKÉMKOLIV pořadí
  { match: /\bknackebrot|kornspitz\b/, fiber: 14, label: 'knäckebrot' },
  { match: /\b(zitn|celozrn|grahamov|tmav|spaldov)[a-z]*\s+(chleb|chleba|rohlik|bulka|houska|veka|baget[a-z]*)\b/, fiber: 6.0, label: 'tmavé pečivo' },
  { match: /\b(chleb|chleba|rohlik|bulka|houska|veka|baget[a-z]*)\s+(zitn|celozrn|grahamov|tmav|spaldov)[a-z]*\b/, fiber: 6.0, label: 'tmavé pečivo' },
  // Pečivo — světlé (default pro chleb/rohlík/bulka bez modifikátoru, nebo s "bílá/toastový")
  { match: /\brohlik\b/, fiber: 3.0, label: 'rohlík bílý' },
  { match: /\b(chleb|chleba|bulka|houska|veka|baget[a-z]*)\b/, fiber: 2.7, label: 'světlé pečivo' },

  // Kaše a obiloviny
  { match: /\bryze\s*(varena|jasmiov[ya]|bila|vasil[ya])?\b/, fiber: 0.4, label: 'rýže vařená' },
  { match: /\btestoviny\s*(varene|integrali|celozrn[ny][ya]?)?\b/, fiber: 1.8, label: 'těstoviny' },
  { match: /\bkuskus\s*(vareny)?\b/, fiber: 1.4, label: 'kuskus' },
  { match: /\bbulgur\s*(vareny)?\b/, fiber: 4.5, label: 'bulgur' },
  { match: /\bquinoa\b/, fiber: 2.8, label: 'quinoa' },
  { match: /\bpohank[ya]\s*(varena)?\b/, fiber: 2.7, label: 'pohanka' },
  { match: /\bovesn[ye]?\s*vlocky\b/, fiber: 10, label: 'ovesné vločky' },
  { match: /\bjahly\s*(varene)?\b/, fiber: 1.3, label: 'jáhly vařené' },

  // Brambory
  { match: /\bbrambor[yae]?\s*(varene|pecene|nove|loupane|americke|grilovane)?\b/, fiber: 1.8, label: 'brambory' },

  // Luštěniny vařené
  { match: /\bcocka\s*(varena|cervena|zelena)?\b/, fiber: 8.0, label: 'čočka vařená' },
  { match: /\bfazole\s*(varene|cervene|bile|cerne)?\b/, fiber: 7.0, label: 'fazole vařené' },
  { match: /\bcizrn[ya]\s*(varena)?\b/, fiber: 7.0, label: 'cizrna vařená' },

  // Ořechy a semínka
  { match: /\bmandle\b/, fiber: 12, label: 'mandle' },
  { match: /\bvlassk[ye]?\s*orech[ya]?\b/, fiber: 7.0, label: 'vlašské ořechy' },
  { match: /\blnen[ye]?\s*seminka\b/, fiber: 27, label: 'lněná semínka' },
  { match: /\bchia\b/, fiber: 34, label: 'chia' },
  { match: /\bslunecnicov[ye]?\s*seminka\b/, fiber: 8.0, label: 'slunečnicová semínka' },
];

// Pokud entry název obsahuje některý z těchto výrazů, kurátorovaný match
// NEAPLIKUJEME. Brání falešné shodě u příchutí, ochucených doplňků, džusů
// (BalanceOil pomeranč → pomeranč; Whey banán → banán atd.).
const CURATED_BLOCKERS = [
  /\bolej(\b|ova|ovy)/, /\boil\b/, /\bbalanceoil\b/,
  /\bdoplnek\b/, /\bsupplement\b/, /\bprotein(ovy|ova|ovych)?\b/, /\bwhey\b/, /\bcasein\b/, /\bbcaa\b/,
  /\bstava\b/, /\bjuice\b/, /\bdzus\b/, /\bsmoothie\b/, /\bnektar\b/, /\bsiroup?\b/, /\bsirup\b/,
  /\bpriichuti?\b/, /\bprichut\b/, /\baroma\b/, /\bochuceny?\b/, /\bflavor\b/, /\bflavour\b/,
  /\bjogurt(ovy|ove)?\b/, /\bkefir\b/, /\bsmetanovy?\b/, /\bpudd?ing\b/, /\bdezert\b/,
  /\bcokolad[a-z]*\b/, /\bsuchar\b/, /\bsusenk[ya]\b/, /\bbisku?vit[ya]?\b/,
  /\bnapoj\b/, /\bdrink\b/, /\bcoctail\b/, /\bkoktejl\b/,
  /\bzmrzlin[ya]\b/, /\bsorbet\b/, /\bmusli\b/, /\bgranol[ya]\b/, /\bcornflakes?\b/,
  /\bbalanceoil\b/, /\bzinzino\b/,
];

function curatedFiberFor(name) {
  const n = normalizeName(name);
  for (const blocker of CURATED_BLOCKERS) {
    if (blocker.test(n)) return null;
  }
  for (const rule of CURATED_FIBER) {
    if (rule.match.test(n)) return { fiber: rule.fiber, label: rule.label };
  }
  return null;
}

async function fetchAllFoodsWithFiber() {
  // Načteme všechny foods záznamy s vlákninou > 0 jednou — používá se pro
  // všechny varianty matche.
  const { data, error } = await supabase
    .from('foods')
    .select('title, brand, fiber')
    .gt('fiber', 0);
  if (error) throw error;
  return data || [];
}

function buildFoodIndexes(foods) {
  // Tři indexy podle různých klíčů. Hodnota = { fiber, count }.
  const byNameBrand = new Map();      // exact name+brand (lower, no diacritics)
  const byNameOnly = new Map();       // exact name (lower, no diacritics)
  for (const row of foods) {
    const name = normalizeName(row.title);
    const brand = normalizeName(row.brand);
    if (!name) continue;
    const k1 = `${name}||${brand}`;
    const c1 = byNameBrand.get(k1);
    if (!c1) byNameBrand.set(k1, { fiber: row.fiber, count: 1 });
    else { c1.count++; c1.fiber = row.fiber; }

    const c2 = byNameOnly.get(name);
    if (!c2) byNameOnly.set(name, { fiber: row.fiber, count: 1 });
    else { c2.count++; c2.fiber = row.fiber; }
  }
  return { byNameBrand, byNameOnly };
}

async function fetchFoodsByIds(ids) {
  const map = new Map();
  const PAGE = 500;
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('foods')
      .select('id, fiber')
      .in('id', slice);
    if (error) throw error;
    for (const row of data || []) {
      if (typeof row.fiber === 'number' && row.fiber > 0) {
        map.set(row.id, row.fiber);
      }
    }
  }
  return map;
}

function buildEntryUpdate(entry, fiberPer100g) {
  const grams = Number(entry.grams) || 0;
  if (grams <= 0) return null;
  // V diary_entries je vláknina v gramech POLOŽKY, ne na 100 g — viz schema
  // (ostatní makra jsou taky v g položky). Přepočet z foods (g/100g):
  const newFiber = Math.round(((fiberPer100g * grams) / 100) * 10) / 10;
  if (newFiber <= 0) return null;
  return { id: entry.id, name: entry.name, grams, oldFiber: entry.fiber, newFiber };
}

async function collectIdMatches() {
  console.log(`\n— Pass: id-match (food_id IS NOT NULL) —`);
  const entries = await fetchEntriesNeedingFiber({ withFoodId: true });
  console.log(`Kandidáti: ${entries.length}`);
  if (entries.length === 0) return [];

  const uniqueFoodIds = [...new Set(entries.map((e) => e.food_id))];
  console.log(`Foods k načtení: ${uniqueFoodIds.length}`);
  const foodFiber = await fetchFoodsByIds(uniqueFoodIds);
  console.log(`Z toho s fiber > 0: ${foodFiber.size}`);

  const updates = [];
  for (const e of entries) {
    const fiberPer100g = foodFiber.get(e.food_id);
    if (!fiberPer100g) continue;
    const u = buildEntryUpdate(e, fiberPer100g);
    if (u) updates.push(u);
  }
  return updates;
}

async function collectNameMatches() {
  console.log(`\n— Pass: name-match (food_id IS NULL) —`);
  const entries = await fetchEntriesNeedingFiber({ withFoodId: false });
  console.log(`Kandidáti: ${entries.length}`);
  if (entries.length === 0) return [];

  const foods = await fetchAllFoodsWithFiber();
  const { byNameBrand, byNameOnly } = buildFoodIndexes(foods);

  const updates = [];
  let hitNameBrand = 0;
  let hitNameOnly = 0;
  const unmatched = [];

  for (const e of entries) {
    const name = normalizeName(e.name);
    const brand = normalizeName(e.brand || '');
    let fiber = null;

    const a = byNameBrand.get(`${name}||${brand}`);
    if (a && a.count === 1) { fiber = a.fiber; hitNameBrand++; }

    if (fiber == null) {
      const b = byNameOnly.get(name);
      if (b && b.count === 1) { fiber = b.fiber; hitNameOnly++; }
    }

    if (fiber == null) {
      unmatched.push(e);
      continue;
    }
    const u = buildEntryUpdate(e, fiber);
    if (u) updates.push(u);
  }

  console.log(`Shod přes name+brand: ${hitNameBrand}`);
  console.log(`Shod přes name-only:   ${hitNameOnly}`);
  console.log(`Bez shody:             ${unmatched.length}`);
  if (DRY_RUN && unmatched.length > 0) {
    console.log(`\nNespárované kandidáti (vypisuji do 30):`);
    for (const e of unmatched.slice(0, 30)) {
      console.log(`  "${e.name}"${e.brand ? ` [${e.brand}]` : ''}  (${e.grams} g)`);
    }
    if (unmatched.length > 30) console.log(`  … a dalších ${unmatched.length - 30}`);
  }

  return updates;
}

async function collectCuratedMatches() {
  console.log(`\n— Pass: curated-match (hardcoded fiber pro běžné potraviny) —`);
  // Bere VŠECHNY entries s fiber=0 bez ohledu na food_id, protože i u entries
  // s vyplněným food_id může být foods.fiber=0 (rozbitý číselník).
  const allEntries = [];
  for (const withFoodId of [true, false]) {
    const part = await fetchEntriesNeedingFiber({ withFoodId });
    allEntries.push(...part);
  }
  console.log(`Kandidáti: ${allEntries.length}`);

  const updates = [];
  const matchedByLabel = new Map();
  for (const e of allEntries) {
    const hit = curatedFiberFor(e.name);
    if (!hit) continue;
    const u = buildEntryUpdate(e, hit.fiber);
    if (u) {
      u.curatedLabel = hit.label;
      updates.push(u);
      matchedByLabel.set(hit.label, (matchedByLabel.get(hit.label) || 0) + 1);
    }
  }

  console.log(`Spárováno přes kurátorovaný seznam: ${updates.length}`);
  if (DRY_RUN && matchedByLabel.size > 0) {
    const sorted = [...matchedByLabel.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Rozpis podle kategorie:`);
    for (const [label, count] of sorted) console.log(`  ${count.toString().padStart(4)}× ${label}`);
  }
  return updates;
}

function dedupeUpdatesByEntryId(list) {
  // Stejné entry mohlo projít víc průchody — necháme první (id-match má přednost).
  const seen = new Set();
  const out = [];
  for (const u of list) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

async function fetchFoodsNeedingFiber() {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('foods')
      .select('id, title, brand, fiber')
      .or('fiber.is.null,fiber.eq.0')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function applyCuratedToFoods() {
  console.log(`\n— Pass: fix-foods (kurátorovaný fiber → tabulka foods) —`);
  const rows = await fetchFoodsNeedingFiber();
  console.log(`Foods s fiber NULL nebo 0: ${rows.length}`);

  const updates = [];
  const matchedByLabel = new Map();
  for (const row of rows) {
    const hit = curatedFiberFor(row.title);
    if (!hit) continue;
    updates.push({ id: row.id, title: row.title, oldFiber: row.fiber, newFiber: hit.fiber, label: hit.label });
    matchedByLabel.set(hit.label, (matchedByLabel.get(hit.label) || 0) + 1);
  }

  console.log(`Spárováno: ${updates.length}`);
  if (matchedByLabel.size > 0) {
    const sorted = [...matchedByLabel.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Rozpis podle kategorie:`);
    for (const [label, count] of sorted) console.log(`  ${count.toString().padStart(4)}× ${label}`);
  }

  if (DRY_RUN) {
    for (const u of updates.slice(0, 60)) {
      console.log(`  ${u.oldFiber == null ? 'null' : u.oldFiber} → ${u.newFiber} g/100g  [${u.label}]  ${u.title}`);
    }
    if (updates.length > 60) console.log(`  … a dalších ${updates.length - 60}`);
    console.log(`\nDRY RUN: do foods nezapsáno.`);
    return updates.length;
  }

  let done = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('foods')
      .update({ fiber: u.newFiber })
      .eq('id', u.id);
    if (error) console.error(`Update foods ${u.id} error:`, error.message);
    else done++;
  }
  console.log(`\nFoods opraveno: ${done} / ${updates.length}.`);
  return done;
}

async function main() {
  console.log(`Backfill diary_entries.fiber, mode=match=${MATCH}${FIX_FOODS ? ', fix-foods' : ''}${DRY_RUN ? ' [DRY RUN]' : ''}`);

  if (FIX_FOODS) {
    await applyCuratedToFoods();
  }


  const all = [];
  if (MATCH === 'id' || MATCH === 'both' || MATCH === 'all') {
    all.push(...(await collectIdMatches()));
  }
  if (MATCH === 'name' || MATCH === 'both' || MATCH === 'all') {
    all.push(...(await collectNameMatches()));
  }
  if (MATCH === 'curated' || MATCH === 'all') {
    all.push(...(await collectCuratedMatches()));
  }
  const updates = dedupeUpdatesByEntryId(all);

  console.log(`\nK úpravě celkem: ${updates.length} entries.`);
  if (updates.length === 0) {
    console.log('Nic k práci. Hotovo.');
    return;
  }

  if (DRY_RUN) {
    for (const u of updates.slice(0, 80)) {
      console.log(`  ${u.oldFiber} → ${u.newFiber} g  (${u.grams} g)  ${u.name}`);
    }
    if (updates.length > 80) console.log(`  … a dalších ${updates.length - 80}`);
    console.log('\nDRY RUN: do DB nezapsáno.');
    return;
  }

  let done = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('diary_entries')
      .update({ fiber: u.newFiber })
      .eq('id', u.id);
    if (error) console.error(`Update ${u.id} error:`, error.message);
    else done++;
  }
  console.log(`\nHotovo. Opraveno ${done} / ${updates.length} entries.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
