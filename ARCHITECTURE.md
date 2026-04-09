# Food Tracker — Architektura a podklad pro security review

## 1. Co aplikace dělá

Food Tracker je webová aplikace pro online fitness trenéra (David Klement) a jeho klientky. Klientky si zapisují jídelníček a aktivity, trenér jim dává zpětnou vazbu — buď ručně, nebo pomocí AI (Claude API), která napíše komentář ve stylu trenéra.

**Hlavní role a funkce:**
- **Klientka (`role = 'client'`)** — zapisuje jídla do deníku (snídaně, svačiny, oběd, večeře, kalorický dluh), skenuje čárové kódy, sleduje váhu, kalorie, makra, aktivity, cíle. Vidí komentáře od trenéra/AI ke svým jídlům.
- **Trenér (`role = 'trainer'`)** — dashboard se všemi klientkami, čte cizí deníky, píše komentáře (ručně nebo generuje AI), spravuje databázi potravin, maže klientky.
- **AI komentáře** — Claude (model `claude-sonnet-4-20250514`) generuje komentáře k jednotlivým jídlům ve stylu trenéra podle `_shared/styleGuide.ts`.

## 2. Co spolu aktuálně řešíme

Podle posledních commitů pracujeme na **tekutinách a jednotkách u potravin**:
- `ml` jednotka u user-created potravin a v jídelníčku
- derive unit + portions z foods při fetchu
- heuristika podle názvu přebíjí zastaralý unit + fallback na porce
- před tím: mobilní úpravy trenérského dashboardu (zvětšení tlačítek, oprava přetečení karet)

## 3. Tech stack

| Vrstva | Technologie |
|---|---|
| Frontend | React 19 + Vite 8, čistý JS (no TS), Chart.js, `@zxing/browser` pro skenování čárových kódů |
| Auth + DB + Storage | Supabase (Postgres + Auth + Edge Functions) |
| Serverless | Supabase Edge Functions (Deno) — `generate-comment`, `generate-all-comments`, `delete-client` |
| AI | Anthropic Claude API (volané z edge functions přes service role) |
| Externí data | Open Food Facts (CZ import), USDA seed, kaloricketabulky.cz sitemap import, překlad do CZ |
| Build / deploy | Vite (SPA), Supabase CLI pro migrace + functions |

## 4. Struktura repozitáře

```
food-tracker/
├── src/
│   ├── App.jsx                    # router-less SPA shell, routuje podle state
│   ├── main.jsx
│   ├── lib/supabase.js            # createClient(URL, ANON_KEY) — hardcoded
│   ├── contexts/AuthContext.jsx   # user + profile + role
│   ├── hooks/
│   │   ├── useSupabaseDiary.js    # CRUD diary_days, diary_entries, meal_notes
│   │   ├── useActivityDiary.js
│   │   ├── useWeightTracker.js
│   │   ├── useCalorieHistory.js
│   │   ├── useGoalHistory.js
│   │   ├── useTrainerData.js      # trenérský přehled klientek
│   │   └── useLocalStorage.js
│   ├── components/
│   │   ├── AuthPage.jsx
│   │   ├── SearchBar.jsx / FoodSearchModal.jsx / BarcodeScanner.jsx
│   │   ├── MealSection.jsx / DailySummary.jsx
│   │   ├── TrainerDashboard.jsx / TrainerClientDiary.jsx / TrainerComment.jsx
│   │   ├── FoodsDatabasePage.jsx / AnalysisPage.jsx / SettingsPage.jsx
│   │   ├── WeightTracker.jsx
│   │   └── ActivitySection.jsx / ActivitySearchModal.jsx
│   └── utils/
│       ├── foodSearch.js          # ranking, RPC search_foods
│       └── barcodeLookup.js       # Open Food Facts lookup
├── supabase/
│   ├── migrations/                # 16 migrací — schema + RLS + RPC
│   ├── functions/
│   │   ├── _shared/styleGuide.ts  # system prompt pro Claude
│   │   ├── generate-comment/      # POST jedno jídlo → AI komentář + log
│   │   ├── generate-all-comments/ # batch pro celý den
│   │   └── delete-client/         # trenérské smazání klientky (admin API)
│   └── config.toml
├── scripts/                       # offline Node skripty pro seed/import/překlad
│   ├── fetch-kt-foods.mjs, fetch-kt-sitemap.mjs
│   ├── seed-usda-foods.mjs, import-foods-to-supabase.mjs
│   ├── translate-foods-to-czech.mjs, retranslate-meat.mjs
│   ├── generate-portions-ai.mjs, fill-portions-ai.mjs
│   ├── dedupe-simulate.mjs, dedupe-apply.mjs, detect-duplicates.mjs
│   └── cleanup-titles.mjs, test-search-ranking.mjs
└── package.json
```

## 5. Datový model (Postgres)

| Tabulka | Popis | Vlastník řádku |
|---|---|---|
| `profiles` | 1:1 s `auth.users`, role `client`/`trainer`, cíle (kcal, makra) | `id = auth.uid()` |
| `diary_days` | 1 řádek na (user, datum) | `user_id` |
| `diary_entries` | položky jídel (meal_id, grams, kcal, makra, unit, display_amount) | přes `day_id → diary_days` |
| `meal_notes` | osobní poznámky klientky k jídlu | přes `day_id` |
| `trainer_comments` | komentář trenéra nebo AI k jídlu (`author in ('trainer','ai')`) | trenér / čte klient vlastní |
| `ai_comment_log` | audit tokenů + raw response od Claude | jen trenér čte |
| `foods` | databáze potravin (migrace 011+), RPC `search_foods` + unaccent ranking | sdílené, user-created přes approval flag (015) |
| `weight_entries`, `goal_history`, `activities`, `activity_notes` | tracking | `user_id` |

**Row-Level Security** je zapnuté na všech hlavních tabulkách (`002_rls_policies.sql`). Klíčové politiky:
- klient vidí/edituje jen své řádky (přes `auth.uid()` nebo join na `diary_days.user_id`)
- trenér má `SELECT` na všechny profily/deníky (helper `public.is_trainer()` je `SECURITY DEFINER`)
- trenér má write na `trainer_comments` (migrace 008 `trainer_write`)
- edge functions obcházejí RLS přes `SUPABASE_SERVICE_ROLE_KEY`

## 6. Ověřování a autorizace

- **Supabase Auth** (email + heslo) přes `@supabase/supabase-js` v prohlížeči.
- **Anon key** je zapečený v `src/lib/supabase.js` (rozdělený do tří stringů jako obrana proti truncation, ne jako bezpečnostní opatření — JWT je veřejný, bezpečnost drží RLS).
- **Profil + role** se načítá v `AuthContext.jsx` po přihlášení; `isTrainer` gatuje trenérské obrazovky v UI (ale autorizace musí stát na RLS, ne na UI).
- **Edge functions** dostávají `Authorization: Bearer <user JWT>` od klienta, uvnitř si instancují `service role` klienta pro zápisy, které by RLS neumožnil (AI komentáře, mazání klientky).

## 7. Externí integrace

- **Claude API** (`api.anthropic.com/v1/messages`) — volané pouze z edge functions, `ANTHROPIC_API_KEY` v Supabase secrets, model `claude-sonnet-4-20250514`, system prompt se cachuje (`cache_control: ephemeral`).
- **Open Food Facts** — lookup podle EAN z prohlížeče (`utils/barcodeLookup.js`), bez klíče.
- **kaloricketabulky.cz** — offline crawler (`scripts/fetch-kt-*`) pro seed DB potravin.
- **USDA FoodData Central** — offline seed.

## 8. Diagram architektury

```
                       ┌────────────────────────────────────────┐
                       │              Browser (SPA)             │
                       │  React 19 + Vite  •  anon JWT in JS    │
                       │                                        │
                       │  ┌──────────┐  ┌──────────┐  ┌───────┐ │
                       │  │ Client UI│  │ Trainer  │  │Barcode│ │
                       │  │ (deník)  │  │Dashboard │  │Scanner│ │
                       │  └────┬─────┘  └────┬─────┘  └───┬───┘ │
                       │       │             │            │     │
                       │  ┌────▼─────────────▼───┐        │     │
                       │  │   supabase-js client │        │     │
                       │  │   (anon key + user   │        │     │
                       │  │         JWT)         │        │     │
                       │  └────┬─────────┬───────┘        │     │
                       └───────┼─────────┼────────────────┼─────┘
                               │         │                │
                      HTTPS /  │   HTTPS │ invoke         │ HTTPS (no key)
                      PostgREST│         │ edge fn        │
                               │         │                ▼
                 ┌─────────────▼───┐     │        ┌───────────────┐
                 │  Supabase       │     │        │ Open Food     │
                 │  Postgres + RLS │     │        │ Facts (EAN)   │
                 │                 │     │        └───────────────┘
                 │  profiles       │     │
                 │  diary_days     │     │
                 │  diary_entries  │     │
                 │  meal_notes     │     │
                 │  trainer_comm.  │◄────┼──── service role
                 │  ai_comment_log │     │          ▲
                 │  foods + RPC    │     │          │
                 │  weight / goals │     │          │
                 │  activities     │     │          │
                 └──────┬──────────┘     │          │
                        │                │   ┌──────┴─────────────────┐
                        │                └──►│  Supabase Edge Funcs   │
                        │                    │  (Deno)                │
                        │                    │                        │
                        │                    │  generate-comment      │
                        │                    │  generate-all-comments │
                        │                    │  delete-client         │
                        │                    └──────────┬─────────────┘
                        │                               │
                        │                               │ x-api-key (secret)
                        │                               ▼
                        │                       ┌───────────────┐
                        │                       │ Anthropic API │
                        │                       │ Claude Sonnet │
                        │                       └───────────────┘
                        │
          ┌─────────────▼─────────────┐
          │  Offline scripts (Node)   │
          │  seed / import / dedupe / │
          │  translate / AI portions  │
          │  → service role key       │
          └───────────────────────────┘
```

## 9. Jaké nástroje používám (Claude Code)

Pracuji přes **Claude Code** CLI (model Opus 4.6, 1M context) v tomto repu. Dostupné nástroje, které reálně používám při práci na tomto projektu:

**Čtení a navigace kódu**
- `Read` — čtení souborů s čísly řádků
- `Glob` — hledání souborů podle vzoru
- `Grep` (ripgrep) — hledání v obsahu
- `Agent` se subagenty `Explore` / `Plan` — delší průzkum a plánování

**Editace**
- `Edit` — přesné stringové náhrady
- `Write` — nové soubory / přepisy (jako tento dokument)
- `NotebookEdit` — .ipynb

**Shell**
- `Bash` — git, npm, supabase CLI, Node skripty v `scripts/`

**Verifikace běhu (dev preview)**
- `mcp__Claude_Preview__preview_start/stop/list/logs` — Vite dev server
- `preview_screenshot / snapshot / inspect / click / fill / eval / console_logs / network / resize` — ověřování UI změn v prohlížeči

**Plánování a úkoly**
- `TodoWrite` — tracking víceúrokových úkolů
- `EnterPlanMode` / `ExitPlanMode` — design před implementací
- `AskUserQuestion` — doptávání se

**Ostatní**
- `WebFetch` / `WebSearch` — dokumentace, aktuální info
- `Skill` — uživatelské skilly (např. `jidelnicek-feedback` pro komentáře ke klientkám na kaloricketabulky.cz)
- `mcp__scheduled-tasks__*` — naplánované úkoly
- Perzistentní **memory** systém v `~/.claude/projects/.../memory/`

Supabase secrety (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`) **nevidím** — žijí jen v Supabase env pro edge functions.

## 10. Povrch pro security review — co se hodí prověřit

Body, na které bych se při review zaměřil (bez toho, že bych tvrdil, že jsou chybné — jen to jsou přirozené hotspoty):

1. **RLS completeness** — každá tabulka, která drží data klientek (včetně novějších `foods`, `weight_entries`, `activities`, `activity_notes`, `goal_history`), musí mít RLS zapnuté a politiky pokrývající `SELECT/INSERT/UPDATE/DELETE`. Migrace 001/002 pokrývají původní tabulky; ověřit 004–016.
2. **`is_trainer()` jako `SECURITY DEFINER`** — funkce obchází RLS. Zkontrolovat, že se používá jen ke čtení vlastního role-checku a že nejde zneužít.
3. **Edge functions a service role** — `generate-comment` přijímá `day_id`, `meal_id`, `meal_entries`, `client_goals` přímo z requestu bez ověření, že volající je trenér a že `day_id` existuje / patří klientce. Service role pak píše do `trainer_comments` a `ai_comment_log` s čímkoliv, co přišlo. **To je asi největší risk.**
4. **`delete-client`** — obsahuje admin API volání (`auth.admin.deleteUser`?). Ověřit authz check (trenér) + scope.
5. **Prompt injection do Claude API** — `meal_entries[].name` jde rovnou do user promptu. Klientka může do názvu potraviny napsat cokoliv. Dopad je omezený (max 250 znaků výstupu, comment do DB), ale style-guide a persona se dají pošťouchnout.
6. **CORS `Access-Control-Allow-Origin: *`** na edge functions — v kombinaci s `Authorization` headerem je to OK pro veřejné API, ale pro funkce volané jen z appky lze zúžit na origin.
7. **Anon key v bundle** — OK (je to public JWT), bezpečnost drží RLS. Stojí za zmínku v reportu jen jako "not a finding".
8. **Barcode lookup přes Open Food Facts** — klient přímo fetch bez sanitizace response; odpověď jde do UI/stavu. XSS by musela přijít přes React rendering (ten escapuje), ale stojí za prověření, jestli se někde nepoužívá `dangerouslySetInnerHTML`.
9. **`ai_comment_log.raw_response`** — ukládá se celé tělo odpovědi od Claude. Pokud by tam Anthropic vracelo něco citlivého (neměl by), je to v DB. Trenér to čte.
10. **Skripty v `scripts/`** — používají service role key z lokálního envu. Ověřit, že `.env` není v gitu (běžný prohřešek).
11. **Auth flow** — `AuthPage.jsx` + `AuthContext.jsx`: signup, password reset, session persistence (Supabase default je localStorage — XSS → session theft). Zkontrolovat CSP.
12. **Chybějící CSP / security headers** — SPA hostovaná kde? Vite build → statický hosting. Nastavit `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`.
13. **Rate limiting** — edge funkce volající Claude API nemají žádný rate limit / quota guard. Kompromitovaný klientský JWT → neomezené volání Claude na účet.
14. **Foods table (`015_user_foods_approval.sql`)** — user-created potraviny s approval flagem; ověřit, že neapprovované se nezobrazují všem klientkám.

---

*Vygenerováno Claude Code (Opus 4.6) jako podklad pro security review — 2026-04-09.*
