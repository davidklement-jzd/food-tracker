# 06 — Offline skripty a seed data

Skripty v `scripts/` jsou **offline nástroje** (ESM `.mjs`, jeden `.sh`), **ne runtime appky**.
Slouží k naplnění a údržbě databáze potravin (`foods`). Spouští se `node scripts/<name>.mjs`, env
proměnné se předávají inline. Skripty stahující z webu se samy rate-limitují (~1–1,5 s/request).
SQL patche a logy jdou do `tmp/` (gitignored).

Většina zápisů do Supabase používá **service role** klíč. AI obohacení používá **Claude Haiku**
(model `claude-haiku-4-5-20251001` — pozn.: jiný model než edge funkce; Haiku je levné na dávky).

---

## Stahování / import (externí zdroje)

| Skript | Co dělá | Zdroj | Zápis do DB? |
|---|---|---|---|
| `fetch-kt-sitemap.mjs` | Stáhne 8 sub-sitemap potravin, uloží slug→URL index do `data/kt-slugs.json` | kaloricketabulky.cz | ne |
| `fetch-kt-foods.mjs` | Pro položky z `data/cz-classics.tsv` najde KT slug, stáhne makra → `data/manual-cz.jsonl` + `tmp/*.sql`. Resumable. | kaloricketabulky.cz | ne (přes SQL) |
| `seed-usda-foods.mjs` | Stáhne generické potraviny (Foundation + SR Legacy) → `data/usda-foods.jsonl`. Potřebuje `USDA_API_KEY`. | USDA FoodData Central | ne |
| `import-off-cz.sh` | Stáhne ~7,3 GB OFF Parquet dump (HuggingFace) a přes DuckDB vyfiltruje české produkty → `data/off-cz.jsonl`. Potřebuje `duckdb` CLI. | Open Food Facts | ne |
| `import-foods-to-supabase.mjs` | Nahraje libovolný kompatibilní JSONL do `foods` (upsert na `id`, dávky 500, dedupe). `node … data/<file>.jsonl` | — | **ano (service role)** |

## Překlad (Claude Haiku)

| Skript | Co dělá |
|---|---|
| `translate-foods-to-czech.mjs` | Přeloží názvy/kategorie z `data/usda-foods.jsonl` do češtiny + přidá typickou porci → `data/foods-cz.jsonl`. AI se dotýká jen textu/porce, **nikdy výživy**. Resumable. Potřebuje `ANTHROPIC_API_KEY`. |
| `retranslate-meat.mjs` | Přeloží USDA masné řezy do přirozené české řeznické terminologie; `--dry` náhled. |

## Porce / vláknina — AI obohacení (service role + `ANTHROPIC_API_KEY`)

| Skript | Co dělá |
|---|---|
| `fill-portions-ai.mjs` | Doplní chybějící `default_grams` na `foods` přes Haiku. `--source=`, `--limit=`. |
| `generate-portions-ai.mjs` | Vygeneruje 2–4 varianty porcí `{label,grams}` na potravinu. |
| `fill-fiber-ai.mjs` | Odhadne `fiber` (g/100 g) tam, kde je NULL. `--source=`, `--limit=`, `--dry-run`, `--mode=null|zero`. |
| `backfill-entry-fiber.mjs` | Zkopíruje vlákninu z `foods` do `diary_entries`, kde je entry fiber 0 (přepíše jen 0, ne ne-null). Bez AI. `--match=id|name|curated`, `--dry-run`. |

## Deduplikace

| Skript | Co dělá |
|---|---|
| `detect-duplicates.mjs` | Offline report duplicit napříč JSONL. Bez zápisu. |
| `dedupe-simulate.mjs` | Dry simulace dedupe pravidel (±15 % makro tolerance; priorita manual>usda>off; nikdy nemaže OFF řádky s EAN — potřeba pro sken). Report. |
| `dedupe-apply.mjs` | Aplikuje pravidla: `tmp/dedupe-delete.sql` + přepíše `data/foods-cz.jsonl`. |
| `dedupe-supabase.mjs` | Stejná logika přímo proti `foods` v Supabase. Dry-run default; `--apply` maže. Service role. |

## Opravy / údržba

| Skript | Co dělá |
|---|---|
| `cleanup-titles.mjs` | Heuristické (bez AI) čištění českých názvů (", raw"→" syrové", překlepy). `--dry`. |
| `fix-goal-history-gaps.mjs` | Jednorázový backfill mezer v `goal_history` per klient/cíl proti aktuálním cílům profilu. Service role. |
| `fix-ham-portions.mjs` | Přepočte porce šunek/nářezů v `foods` z OFF `quantity`/`serving_size` (DuckDB Parquet). Dry default; `--apply`. Service role + `duckdb`. |

## Testování

| Skript | Co dělá |
|---|---|
| `test-search-ranking.mjs` | Offline simulace řazení `search_foods` (zrcadlí migraci 013) nad lokálním JSONL. Bere query argumenty. Bez DB. |

---

## Seed data (`data/`)

`.gitignore` trackuje **čtyři curated, ručně psané** seed soubory (zbytek pod `data/` je gitignored,
protože je reprodukovatelný dump):

| Soubor | Obsah |
|---|---|
| `cz-classics.tsv` (447 řádků) | Curated seznam českých klasik. TSV header `title\tcategory`. Vstup pro `fetch-kt-foods.mjs`. |
| `fastfood-cz.jsonl` (31 řádků) | Ručně psaná fast-food DB (např. `ff-mcd-bigmac`). |
| `alcohol-cz.jsonl` (87 řádků) | Ručně psaný alkohol/nápoje (`is_liquid:true`, více porcí). |
| `sweets-cz.jsonl` (80 řádků) | Ručně psané sladké/dezerty. |

Schema JSONL řádku: `id, title, brand?, category, kcal, protein, carbs, fat, fiber, default_grams,
portions[{label,grams}], is_liquid?, source, confidence`.

Netrackované (gitignored) pracovní soubory: `usda-foods.jsonl`, `off-cz.jsonl`, `foods-cz.jsonl`,
`manual-cz.jsonl`, `kt-slugs.json`, `*.state.json`.

---

## Claude Code automatizace — `jidelnicek-feedback` skill

`jidelnicek-feedback-5.4.skill` je ZIP archiv (Claude Code skill) se dvěma soubory:
- **`SKILL.md`** — skill, který přes prohlížeč čte na **kaloricketabulky.cz** předchozí den
  jídelníčku klientky a píše Davidovy komentáře přímo do (AngularJS) appky. Pravidla: vždy vykání;
  jeden `writeComment` na jedno volání (jinak Angular 1.5.8 bug hodí všechny poznámky do snídaně);
  červené kalorie → povinné „musím udělat přepis"; ticho v chatu (jen checkpointy K1–K5 + finální shrnutí).
- **`functions.js`** — JS injektovaný do stránky: `getCalorieCircleColor()` (samplování barvy
  kalorického kruhu), `window.wc(meal, text)` (otevře dialog a zapíše komentář), `extractDiary()` (scrape).

Tenhle skill je **starší workflow** (komentování na cizím webu). Směr projektu je vlastní appka
s AI komentáři přes edge funkce. Skill dokumentuji pro úplnost — pro rebuild appky ho nepotřebuješ.

`.claude/` (netrackovaný, lokální): `launch.json` (dev server), `settings.local.json` (povolené
příkazy), `style-feedback-notes.md` (~15 KB poznámek ke stylu), `worktrees/`.
