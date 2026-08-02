# 01 — Architektura a tech stack

## Tech stack

| Vrstva | Technologie | Detail |
|--------|-------------|--------|
| **Frontend** | React 19 + Vite 8 | Čistý JavaScript (žádný TypeScript), JSX. SPA (single-page app). |
| **Grafy** | Chart.js 4 + react-chartjs-2 5 | Váha + kalorie na stránce Analýza. |
| **Čárové kódy** | `@zxing/browser` 0.1.5 | Fallback ke native `BarcodeDetector`. |
| **Auth + DB + Storage + Realtime** | Supabase | Postgres + Supabase Auth (email/heslo) + Realtime + Edge Functions. |
| **Serverless** | Supabase Edge Functions (Deno / TypeScript) | `generate-comment`, `generate-all-comments`, `delete-client`, `notify-new-client`. |
| **AI** | Anthropic Claude API | Voláno **jen z edge funkcí** přes service role. Model default `claude-sonnet-4-6` (env `AI_MODEL`). |
| **E-mail** | Resend | Notifikace „nová klientka" trenérovi. |
| **Externí data** | Open Food Facts, USDA, kaloricketabulky.cz | Seed databáze potravin + runtime lookup EAN (OFF). |
| **Hosting FE** | Vercel | Push na `main` → build `vite build` → statický `dist/`. |
| **Build/deploy BE** | Supabase CLI | Migrace + edge funkce nasazovány **ručně**. |

Klíčové vlastnosti stacku:
- **Žádný router** — navigace je řešená React stavem v `App.jsx` (viz [03-frontend.md](03-frontend.md)).
- **Žádný TypeScript na frontendu** — jen `.jsx`/`.js`. Edge funkce jsou v TS (Deno).
- **PWA** — `manifest.json`, ikony, apple-touch-icon, theme-color; appka se dá „nainstalovat".

## Jak vrstvy komunikují

1. **Prohlížeč → Supabase (přímo).** Frontend používá `@supabase/supabase-js` s **anon klíčem**
   (veřejný JWT, zapečený v `src/lib/supabase.js`) a **user JWT** po přihlášení. Čte/zapisuje
   tabulky přes PostgREST a volá RPC funkce. **Bezpečnost drží Row-Level Security (RLS)** —
   anon klíč sám o sobě nic neodemyká.

2. **Prohlížeč → Edge funkce.** Pro operace, které RLS klientovi nedovolí (zápis AI komentářů,
   mazání klientky), volá frontend edge funkce přes `supabase.functions.invoke(...)`. Předává
   **user JWT** v `Authorization: Bearer`. Funkce si uvnitř ověří, že volající je **trenér**
   (`requireTrainer`), a pak použije **service role** klienta, který obchází RLS.

3. **Edge funkce → Anthropic API.** AI komentáře se generují server-side; `ANTHROPIC_API_KEY`
   žije jen v Supabase secrets, nikdy se nedostane do prohlížeče.

4. **Prohlížeč → Open Food Facts (přímo).** Čtečka kódů fetchuje produkt podle EAN bez klíče.

5. **Supabase DB webhook → `notify-new-client`.** Na INSERT do `profiles` se zavolá funkce, která
   pošle trenérovi e-mail přes Resend.

6. **Offline skripty (Node) → Supabase.** Seed/import/dedupe/AI-obohacení běží lokálně se
   **service role** klíčem předaným v env. Nejsou součástí runtime appky.

## Diagram

```
                       ┌────────────────────────────────────────┐
                       │              Prohlížeč (SPA)           │
                       │  React 19 + Vite  •  anon JWT v JS     │
                       │                                        │
                       │  ┌──────────┐  ┌──────────┐  ┌───────┐ │
                       │  │ Klientka │  │  Trenér  │  │ Čtečka│ │
                       │  │  (deník) │  │Dashboard │  │  kódů │ │
                       │  └────┬─────┘  └────┬─────┘  └───┬───┘ │
                       │       │             │            │     │
                       │  ┌────▼─────────────▼───┐        │     │
                       │  │   supabase-js client │        │     │
                       │  │  (anon key + user JWT)│       │     │
                       │  └────┬─────────┬───────┘        │     │
                       └───────┼─────────┼────────────────┼─────┘
                               │         │                │
                      HTTPS /  │   HTTPS │ invoke         │ HTTPS (bez klíče)
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
                 │  activities …   │     │          │
                 └──────┬──────────┘     │   ┌──────┴─────────────────┐
                        │  DB webhook    └──►│  Supabase Edge Funcs   │
                        │  (INSERT profile)  │  (Deno / TS)           │
                        │       │            │  generate-comment      │
                        │       ▼            │  generate-all-comments │
                        │  notify-new-client │  delete-client         │
                        │       │            └──────────┬─────────────┘
                        │       │ Resend                │ x-api-key (secret)
                        │       ▼                        ▼
                        │  ┌──────────┐          ┌───────────────┐
                        │  │  E-mail  │          │ Anthropic API │
                        │  │ trenérovi│          │ Claude Sonnet │
                        │  └──────────┘          └───────────────┘
                        │
          ┌─────────────▼─────────────┐
          │  Offline skripty (Node)   │
          │  seed / import / dedupe / │
          │  překlad / AI porce       │
          │  → service role key       │
          └───────────────────────────┘
```

## Struktura repozitáře

```
food-tracker/
├── src/                     # React frontend (viz 03-frontend.md)
│   ├── App.jsx              # celá navigace (stavová, bez routeru)
│   ├── main.jsx
│   ├── lib/                 # supabase klient, fetchAllRows, goalHistoryWriter
│   ├── contexts/            # AuthContext
│   ├── hooks/               # 13 hooků (data z Supabase)
│   ├── components/          # ~30 komponent (UI)
│   ├── utils/               # foodSearch, barcodeLookup, dates, week
│   └── data/                # activities.js (živé), czechFoods.js (mrtvý kód)
├── supabase/
│   ├── migrations/          # 001–030 (schema + RLS + RPC + granty) → 02-datovy-model.md
│   ├── functions/           # edge funkce (Deno) → 04-edge-funkce-a-ai.md
│   │   ├── _shared/         # http.ts (AI + auth + CORS), styleGuide.ts (persona)
│   │   ├── generate-comment/
│   │   ├── generate-all-comments/
│   │   ├── delete-client/
│   │   └── notify-new-client/
│   └── config.toml
├── scripts/                 # offline Node skripty → 06-skripty-a-data.md
├── data/                    # curated seed JSONL/TSV → 06-skripty-a-data.md
├── docs/                    # TENTO balík
├── public/                  # PWA ikony, manifest.json
├── index.html               # lang=cs, PWA meta
├── vite.config.js           # React plugin + dev proxy /api/off → Open Food Facts
├── vercel.json              # security headers + CSP (žádné build nastavení)
├── eslint.config.js
└── package.json
```

Detaily každé části jsou v navazujících souborech 02–06.
