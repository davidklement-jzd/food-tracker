#!/usr/bin/env node
// Audit AI komentářů: stáhne komentáře za období, spočítá metriky stylu
// (opakování bilance bílkovin, procenta, čísla, hlášky, zakázaná slova,
// "se tvarohem", 3. osoba, výhledy do dalších jídel...) a vypíše čitelný
// výpis pro ruční čtení. Nic nezapisuje do databáze.
//
// Spuštění (klíče inline jako u ostatních skriptů):
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/audit-comments.mjs --from 2026-09-06 --to 2026-09-08
//
// Volby:
//   --from / --to   rozsah dat deníku (včetně); bez nich posledních 7 dní
//   --client "Jméno"  jen jedna klientka (podřetězec display_name)
//   --dump          zapíše tmp/audit-readable.txt (den, jídla, komentáře)
//   --ai-only       počítá jen komentáře author='ai' (výchozí ano; --all vypne)
//
// Výstup metrik: počet komentářů, ve kterých vzor padl, + dny s bilancí
// bílkovin ve 2+ komentářích (to je nejdůležitější číslo) + věty, které se
// opakují doslova napříč klientkami.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const flag = (name) => args.includes(name);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY (předat inline).");
  process.exit(1);
}
const iso = (d) => d.toISOString().slice(0, 10);
const TO = opt("--to", iso(new Date(Date.now() - 86400e3)));
const FROM = opt("--from", iso(new Date(new Date(TO).getTime() - 6 * 86400e3)));
const CLIENT = opt("--client", null);
const AI_ONLY = !flag("--all");

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// PostgREST vrací max 1000 řádků na dotaz - stránkuj vždy (viz docs/08).
async function all(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const profiles = await all(() => sb.from("profiles").select("id, display_name, role, goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber").eq("role", "client"));
const prof = Object.fromEntries(profiles.map((p) => [p.id, p]));
let days = await all(() => sb.from("diary_days").select("id, user_id, date").gte("date", FROM).lte("date", TO));
days = days.filter((d) => prof[d.user_id] && (!CLIENT || (prof[d.user_id].display_name || "").toLowerCase().includes(CLIENT.toLowerCase())));
const dayIds = days.map((d) => d.id);
const inChunks = async (fn) => { const out = []; for (let i = 0; i < dayIds.length; i += 200) out.push(...(await all(() => fn(dayIds.slice(i, i + 200))))); return out; };
const entries = await inChunks((ids) => sb.from("diary_entries").select("day_id, meal_id, name, grams, unit, kcal, protein, carbs, fat, fiber").in("day_id", ids).order("sort_order"));
const comments = await inChunks((ids) => sb.from("trainer_comments").select("day_id, meal_id, comment_text, author").in("day_id", ids));
const notes = await inChunks((ids) => sb.from("meal_notes").select("day_id, meal_id, note_text").in("day_id", ids));
const goals = await all(() => sb.from("goal_history").select("user_id, date, goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber").lte("date", TO));

const MEALS = ["breakfast", "snack1", "lunch", "snack2", "dinner"];
const LBL = { breakfast: "Snídaně", snack1: "Svačina 1", lunch: "Oběd", snack2: "Svačina 2", dinner: "Večeře", supplements: "Kalorický dluh" };
const n = (v) => Number(v) || 0, r = Math.round;
const goalsFor = (uid, date) => {
  const g = prof[uid]; const h = goals.filter((x) => x.user_id === uid && x.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const pick = (k) => (h && h[k] != null ? h[k] : g[k]);
  return { kcal: pick("goal_kcal") ?? 2000, protein: pick("goal_protein") ?? 100, carbs: pick("goal_carbs") ?? 220, fat: pick("goal_fat") ?? 80, fiber: pick("goal_fiber") ?? 30 };
};
const byDay = {}; for (const e of entries) (byDay[e.day_id] ||= []).push(e);
const cm = {}; for (const c of comments) (cm[c.day_id] ||= {})[c.meal_id] = c;
const nt = {}; for (const x of notes) (nt[x.day_id] ||= {})[x.meal_id] = x.note_text;

const texts = comments.filter((c) => !AI_ONLY || c.author === "ai").map((c) => c.comment_text || "").filter(Boolean);
const perDayTexts = {}; for (const c of comments) if (!AI_ONLY || c.author === "ai") (perDayTexts[c.day_id] ||= []).push(c.comment_text || "");

const pats = {
  "bilance bílkovin v textu": /b[íi]lkovin[^.]*(za (cel[ýy] )?den|celkov|za cel)|(za (cel[ýy] )?den|celkov)[^.]*b[íi]lkovin/i,
  "výhled do dalších jídel (dožene, srovná...)": /do[žz]en|dohnat|doh[áa]n|dolep|(ještě|naštěstí|zatím|už to)[^.]*(srovn|pomůž|dorovn|přijde)|čekají na (oběd|večeři)|u dalších jídel/i,
  "procento denní bilance": /(vych[áa]z[íi]|vy[šs]l[oy]|na|jen|jich|máte) \d{2,3} ?%/i,
  "gramy / kcal v textu": /\d+ ?g\b|\d+ ?kcal/,
  "vláknina": /vl[áa]knin/i,
  "naprostá jednička": /naprost[áa] jedni[čc]ka/i,
  "budu vždy chválit": /budu v[žz]dy chv[áa]lit/i,
  "rád vidím vajíčka": /r[áa]d vid[íi]m vaj/i,
  "ovoce kdykoliv": /ovoce (je perfektn[íi] )?kdykoli|kdykoliv (p[řr]es|b[ěe]hem) dne|d[áa]t kdykoliv/i,
  "nejlepší příloha": /nejlep[šs][íi] (a nejdietn[ěe]j[šs][íi] )?p[řr][íi]loha/i,
  "takhle má vypadat / přesně ono": /takhle (to )?má (vypadat|snídaně|svačina|oběd|večeře)|přesně takhle|je přesně ono/i,
  "jakou si můžete dát": /jak[oáý]u? si (m[ůu][žz]ete|lze) d[áa]t/i,
  "Povedený den": /poveden[ýy] den/i,
  "zakázaná slova": /netradi[čc]n|zaj[íi]mav|neobvykl|zvl[áa][šs]tn|divn|atypick|prázdn[ée] kalorie|bilanc|kalorijn|nádhern|úžasn|překrásn|rozbil|rozstřel|ustřel/i,
  "škoda": /(^|\s)[šs]koda/i,
  "příště": /p[řr][íi][šs]t[ěe]/i,
  "skyr nebo tvaroh": /skyr(u)? nebo tvaroh|tvaroh(u)? nebo skyr/i,
  "\"se\" před b/t/j/v": /(^|\s)se (tvaroh|jablk|balk|vejc|nektarin|brosk|ban[áa]n|meloun|cherry|se )/i,
  "eimam": /eimam/i,
  "3. osoba (přeskočila bez jste)": /(přeskočila|vynechala|dala si|snědla|neměla)(?![^.]*jste)/i,
  "ženský rod 1. os.": /\b(přidala|dala|doporučila|přepsala|zkusila|vyměnila|zvolila|zvážila) bych\b/i,
  "tykání": /\b(zkus|máš|dala jsi|tvoje|tvůj|si dej|přidej)\b/i,
  "přepis": /p[řr]epis|p[řr]ep[íi][šs]/i,
  "slovo komentář": /koment/i,
  "dlouhá pomlčka": /[—–]/,
  "otázka": /\?/,
  "anglicismy": /plain|vybalanc|dessert|air ?fryer|low ?carb|meal ?prep|cheat/i,
  "sebeoprava (ber... berte)": /\w+\.\.\. ?\w+/,
  "začíná 'Jinak' (uřízlá věta)": /^jinak\b/i,
};

console.log(`Období ${FROM} až ${TO}${CLIENT ? `, klientka ~ "${CLIENT}"` : ""}: ${days.length} dnů, ${texts.length} komentářů${AI_ONLY ? " (jen AI)" : ""}`);
const lens = texts.map((t) => t.length);
console.log(`Průměrná délka ${r(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))} znaků, nad 200: ${lens.filter((l) => l > 200).length}, nad 250: ${lens.filter((l) => l > 250).length}, pod 60: ${lens.filter((l) => l < 60).length}`);
const multi = Object.values(perDayTexts).filter((cs) => cs.filter((t) => pats["bilance bílkovin v textu"].test(t)).length >= 2).length;
console.log(`Dny s bilancí bílkovin ve 2+ komentářích: ${multi} z ${Object.keys(perDayTexts).length}  <- hlavní číslo, cíl 0`);
console.log("");
console.log("metrika".padEnd(46) + "počet".padStart(6) + "   %");
for (const [name, re] of Object.entries(pats)) {
  const c = texts.filter((t) => re.test(t)).length;
  console.log(name.padEnd(46) + String(c).padStart(6) + String(r((100 * c) / Math.max(1, texts.length))).padStart(5));
}
const sent = {};
for (const t of texts) for (const s of t.split(/(?<=[.!?])\s+/)) { const k = s.trim().toLowerCase().replace(/[^a-záčďéěíňóřšťúůýž ]/g, ""); if (k.length > 25) sent[k] = (sent[k] || 0) + 1; }
const top = Object.entries(sent).filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("\nVěty opakované doslova 3× a víc:");
for (const [s, v] of top) console.log(`  ${v}× ${s}`);
if (!top.length) console.log("  žádné");

// Ukázky vzorů, které mají být na nule - ať je hned vidět, kde to bylo.
const showFor = ["výhled do dalších jídel (dožene, srovná...)", "zakázaná slova", "\"se\" před b/t/j/v", "3. osoba (přeskočila bez jste)", "ženský rod 1. os.", "tykání", "sebeoprava (ber... berte)", "začíná 'Jinak' (uřízlá věta)"];
const dayInfo = Object.fromEntries(days.map((d) => [d.id, `${prof[d.user_id].display_name} ${d.date}`]));
for (const name of showFor) {
  const hits = comments.filter((c) => (!AI_ONLY || c.author === "ai") && pats[name].test(c.comment_text || ""));
  if (!hits.length) continue;
  console.log(`\n${name}:`);
  for (const c of hits.slice(0, 8)) console.log(`  [${dayInfo[c.day_id]} ${LBL[c.meal_id] || c.meal_id}] ${c.comment_text}`);
}

if (flag("--dump")) {
  const out = [];
  const sorted = days.slice().sort((a, b) => (prof[a.user_id].display_name || "").localeCompare(prof[b.user_id].display_name || "") || a.date.localeCompare(b.date));
  for (const day of sorted) {
    const es = byDay[day.id] || []; if (!es.length) continue;
    const g = goalsFor(day.user_id, day.date);
    const t = es.reduce((a, e) => ({ k: a.k + n(e.kcal), p: a.p + n(e.protein), c: a.c + n(e.carbs), f: a.f + n(e.fat), v: a.v + n(e.fiber) }), { k: 0, p: 0, c: 0, f: 0, v: 0 });
    out.push(`\n===== ${prof[day.user_id].display_name} | ${day.date} | kcal ${r(t.k / g.kcal * 100)}% | B ${r(t.p / g.protein * 100)}% | S ${r(t.c / g.carbs * 100)}% | T ${r(t.f / g.fat * 100)}% | V ${r(t.v / g.fiber * 100)}%`);
    for (const m of [...MEALS, "supplements"]) {
      const list = es.filter((e) => e.meal_id === m); if (!list.length) continue;
      out.push(`[${LBL[m]}] ${r(list.reduce((a, e) => a + n(e.kcal), 0))} kcal, ${r(list.reduce((a, e) => a + n(e.protein), 0))}g B: ` + list.map((e) => `${e.name} ${n(e.grams)}${e.unit || "g"}`).join("; "));
      if (nt[day.id]?.[m]) out.push(`  POZN: "${nt[day.id][m]}"`);
      const c = cm[day.id]?.[m]; if (c) out.push(`  ${c.author === "ai" ? "AI" : "DAVID"}: ${c.comment_text}`);
    }
  }
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  const f = path.join(root, "tmp", "audit-readable.txt");
  fs.writeFileSync(f, out.join("\n"));
  console.log(`\nVýpis pro čtení: ${f} (${out.length} řádků)`);
}
