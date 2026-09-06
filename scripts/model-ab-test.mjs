#!/usr/bin/env node
// Slepý A/B test modelů pro AI komentáře (Sonnet 5 vs Opus 5).
//
// Vygeneruje komentáře k vybraným dnům (tmp/ab-dataset.json) DVĚMA modely,
// bokem - nic nezapisuje do Supabase, klientky nic neuvidí. Používá STEJNÝ
// style guide v2 a STEJNÉ sestavení promptu jako ostrá edge funkce
// (supabase/functions/_shared/), takže se testuje jen model.
//
// Spuštění (klíč se předává inline, jako u ostatních skriptů):
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/model-ab-test.mjs
// Nasucho bez API (jen sestaví prompty a spočítá volání):
//   node scripts/model-ab-test.mjs --dry
//
// Výstup:
//   tmp/ab-results.json  - komentáře označené jen jako model "A" / "B"
//   tmp/ab-key.json      - které písmeno je který model (otevřít až po vyhodnocení)
//   tmp/ab-usage.json    - tokeny a odhad ceny na model
//
// Postup uvnitř dne je stejný jako v produkci: jídla po sobě, komentář
// k obědu už vidí komentáře ke snídani a svačině ze STEJNÉHO běhu.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tmp = path.join(root, "tmp");

const DRY = process.argv.includes("--dry");
const MODELS = ["claude-sonnet-5", "claude-opus-5"];
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? "220");
const CONCURRENCY = 4; // dnů zpracovávaných najednou (každý den = 2 modely paralelně)

// Ceník $/1M tokenů (Anthropic API, 06/2026) - jen pro odhad nákladů.
const PRICE = {
  "claude-sonnet-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5": { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

// ---- Načtení sdíleného kódu edge funkce (TS) přes Node type-stripping ----
// http.ts importuje supabase z esm.sh a čte Deno.env - obojí tady nahradíme.
function loadShared() {
  const src = fs.readFileSync(
    path.join(root, "supabase/functions/_shared/http.ts"),
    "utf8",
  );
  const shimmed =
    "const Deno: any = { env: { get: () => undefined } };\n" +
    src.replace(
      /^import .*esm\.sh.*$/m,
      'type SupabaseClient = any; const createClient: any = () => { throw new Error("no supabase in ab-test"); };',
    );
  fs.mkdirSync(tmp, { recursive: true });
  const shimPath = path.join(tmp, "_http_shim.ts");
  fs.writeFileSync(shimPath, shimmed);
  return Promise.all([
    import(pathToFileURL(shimPath).href),
    import(pathToFileURL(path.join(root, "supabase/functions/_shared/styleGuide.v2.ts")).href),
  ]);
}

const [http, guide] = await loadShared();
const { buildDayContextPrompt, COMMENTABLE_MEAL_ORDER, stripAiReasoning, normalizeDashes, normalizeForeignScript } = http;
const SYSTEM_PROMPT = guide.SYSTEM_PROMPT_V2;

// ---- Data ----
const dataset = JSON.parse(fs.readFileSync(path.join(tmp, "ab-dataset.json"), "utf8"));

// ---- Slepé označení ----
const shuffled = Math.random() < 0.5 ? [...MODELS] : [...MODELS].reverse();
const label = { [shuffled[0]]: "A", [shuffled[1]]: "B" };
if (!DRY) {
  fs.writeFileSync(
    path.join(tmp, "ab-key.json"),
    JSON.stringify({ A: shuffled[0], B: shuffled[1], generated_at: new Date().toISOString() }, null, 2),
  );
}

// ---- Volání Anthropicu (stejná cesta jako edge funkce: raw fetch) ----
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!DRY && !apiKey) {
  console.error("Chybí ANTHROPIC_API_KEY. Spusťte: ANTHROPIC_API_KEY=... node scripts/model-ab-test.mjs");
  process.exit(1);
}

const usage = Object.fromEntries(MODELS.map((m) => [m, { calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, errors: 0 }]));

async function callModel(model, userPrompt) {
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        // Novější modely přemýšlejí ve výchozím stavu - pro 250znakový komentář
        // to nechceme (tokeny přemýšlení by se počítaly do max_tokens).
        thinking: { type: "disabled" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) {
      const u = body.usage ?? {};
      const acc = usage[model];
      acc.calls++;
      acc.in += u.input_tokens ?? 0;
      acc.out += u.output_tokens ?? 0;
      acc.cacheRead += u.cache_read_input_tokens ?? 0;
      acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
      let raw = "";
      for (const b of body.content ?? []) if (b?.type === "text") raw += b.text;
      // Stejné čištění jako v produkci + pojistka na případné <thinking> tagy.
      raw = raw.replace(/<\/?thinking>[\s\S]*?(<\/thinking>|$)/gi, "").trim();
      const cleaned = normalizeDashes(stripAiReasoning(normalizeForeignScript(raw))).slice(0, 250);
      return { text: cleaned, stop: body.stop_reason ?? null, raw };
    }
    lastErr = `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`;
    if ([400, 401, 403, 404].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  usage[model].errors++;
  return { text: null, stop: null, error: lastErr };
}

// ---- Jeden den, jeden model: jídla po sobě jako v produkci ----
async function runDay(day, model) {
  const comments = {};
  const out = [];
  for (const mealId of COMMENTABLE_MEAL_ORDER) {
    const mealEntries = day.entries.filter((e) => e.meal_id === mealId);
    if (mealEntries.length === 0) continue;
    const userPrompt = buildDayContextPrompt({
      clientName: day.client,
      goalKcal: day.goals.kcal,
      goalProtein: day.goals.protein,
      goalCarbs: day.goals.carbs,
      goalFat: day.goals.fat,
      goalFiber: day.goals.fiber,
      entries: day.entries,
      comments,
      currentMealId: mealId,
      currentMealNote: day.notes?.[mealId] ?? "",
    });
    if (DRY) {
      out.push({ meal_id: mealId, prompt_chars: userPrompt.length });
      comments[mealId] = "(dry)";
      continue;
    }
    const r = await callModel(model, userPrompt);
    if (r.text) comments[mealId] = r.text;
    out.push({ meal_id: mealId, text: r.text, stop: r.stop, error: r.error ?? null });
  }
  return out;
}

// ---- Běh ----
const results = [];
let idx = 0;
async function worker() {
  while (idx < dataset.length) {
    const day = dataset[idx++];
    const [r0, r1] = await Promise.all(MODELS.map((m) => runDay(day, m)));
    const byLabel = { [label[MODELS[0]]]: r0, [label[MODELS[1]]]: r1 };
    const meals = COMMENTABLE_MEAL_ORDER.filter((m) => day.entries.some((e) => e.meal_id === m));
    results.push({
      day_id: day.day_id,
      client: day.client,
      date: day.date,
      meals: meals.map((m) => ({
        meal_id: m,
        baseline: day.baseline?.[m] ?? null, // původní komentář z produkce (Sonnet 4.6, nebo David)
        A: byLabel.A.find((x) => x.meal_id === m) ?? null,
        B: byLabel.B.find((x) => x.meal_id === m) ?? null,
      })),
    });
    process.stderr.write(`${results.length}/${dataset.length} ${day.client} ${day.date}\n`);
    if (!DRY) fs.writeFileSync(path.join(tmp, "ab-results.json"), JSON.stringify(results, null, 2));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (DRY) {
  const calls = results.reduce((a, d) => a + d.meals.length, 0);
  console.log(`Nasucho: ${results.length} dnů, ${calls} komentářů na model, ${calls * MODELS.length} volání celkem.`);
  const sample = results[0].meals[0];
  console.log(`Ukázka: ${results[0].client} ${results[0].date} ${sample.meal_id}, prompt ${sample.A.prompt_chars} znaků.`);
} else {
  const cost = {};
  for (const m of MODELS) {
    const u = usage[m];
    const p = PRICE[m];
    cost[m] = { ...u, usd: +((u.in * p.in + u.out * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6).toFixed(3) };
  }
  fs.writeFileSync(path.join(tmp, "ab-usage.json"), JSON.stringify(cost, null, 2));
  console.log("Hotovo. Výsledky: tmp/ab-results.json (A/B), klíč: tmp/ab-key.json, náklady: tmp/ab-usage.json");
  for (const m of MODELS) console.log(`  ${m}: ${cost[m].calls} volání, ${cost[m].errors} chyb, ~${cost[m].usd} $`);
}
