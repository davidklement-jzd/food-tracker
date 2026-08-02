# 05 — Deploy, build a prostředí

## Produkce

- **Frontend:** `jaknazdravetelo.vercel.app` (Vercel).
- **Backend:** Supabase projekt, ref **`uxffnpajkhcvtwzsmrcl`** (`uxffnpajkhcvtwzsmrcl.supabase.co`).
- ⚠️ `topaz.vercel.app` je **mrtvá osiřelá** adresa — ignoruj.

## Jak se co nasazuje (⚠️ dvě oddělené cesty)

### Frontend → automaticky přes Vercel
`git push` na `main` → Vercel spustí `vite build` → naservíruje statický `dist/`.
**Push na main nasadí JEN frontend.** Žádné GitHub Actions / vlastní CI (repo nemá `.github`).

### Backend → RUČNĚ přes Supabase CLI
Migrace ani edge funkce se pushem nenasadí. Musí se ručně:
```bash
# migrace (schema)
supabase db push
# edge funkce (jednotlivě nebo všechny)
supabase functions deploy generate-comment
supabase functions deploy generate-all-comments
supabase functions deploy delete-client
supabase functions deploy notify-new-client
```
(`.claude/settings.local.json` má předpovolené `Bash(supabase functions *)` a `Bash(npx supabase *)`.)

> **Typická past:** změníš edge funkci nebo přidáš migraci, pushneš na main a čekáš efekt — ale
> nasadil se jen frontend. Backend musíš deploynout zvlášť.

---

## Build & konfigurační soubory

### `package.json`
`"type":"module"`. Skripty: `dev`→`vite`, `build`→`vite build`, `lint`→`eslint .`, `preview`→`vite preview`.

**Dependencies:** `@supabase/supabase-js` ^2.101.1, `@zxing/browser` ^0.1.5, `chart.js` ^4.5.1,
`react-chartjs-2` ^5.3.1, `react` ^19.2.4, `react-dom` ^19.2.4.
**devDependencies:** `@eslint/js` + `eslint` ^9.39.4, `@types/react(-dom)` ^19.2.x,
`@vitejs/plugin-react` ^6.0.1, `eslint-plugin-react-hooks` ^7.0.1, `eslint-plugin-react-refresh` ^0.5.2,
`globals` ^17.4.0, `vite` ^8.0.1.

### `vite.config.js`
Jen React plugin + **dev-only proxy** `/api/off` → `https://world.openfoodfacts.net` (staging;
`changeOrigin`, strip prefixu, UA header). Obchází CORS Open Food Facts jen ve vývoji; produkce
mluví s OFF `.org` přímo (viz CSP).

### `vercel.json`
Žádné build nastavení — jen **security headers** na `/(.*)`: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, uzamčená
`Permissions-Policy` (camera=self) a **striktní CSP**. CSP natvrdo obsahuje Supabase origin
`https://uxffnpajkhcvtwzsmrcl.supabase.co` (+ `wss://` pro realtime) a `https://world.openfoodfacts.org`
v `connect-src`; skripty `'self'`, styly povolují Google Fonts.

> Když migruješ na nový Supabase projekt, **aktualizuj origin v CSP** v `vercel.json`, jinak appka
> nebude smět volat backend.

### `eslint.config.js`
Flat config, ignoruje `dist`. `@eslint/js` recommended + react-hooks + react-refresh. Custom
`no-unused-vars` s `varsIgnorePattern: '^[A-Z_]'`.

### `index.html`
`lang="cs"`, title „Jak na zdravé tělo". PWA: favicon, apple-touch-icon `/icon-192.png`,
`/manifest.json`, `theme-color #4caf50`, viewport `interactive-widget=resizes-content`. Mount `#root` z `/src/main.jsx`.

### `.gitignore`
Standardní Vite ignores. Ignoruje `data/*` ale **force-includuje** čtyři seed soubory
(`fastfood-cz.jsonl`, `cz-classics.tsv`, `alcohol-cz.jsonl`, `sweets-cz.jsonl`). Ignoruje `tmp/`,
`supabase/.temp/` a **`.claude/`** (lokální, netrackovaný).

---

## Env proměnné (⚠️ jen NÁZVY, hodnoty nikdy do gitu)

### Frontend (`.env.local`, vzor `.env.local.example`)
```
VITE_SUPABASE_URL       # URL Supabase projektu
VITE_SUPABASE_ANON_KEY  # veřejný anon JWT
```
Pozn.: anon klíč je i zapečený v `src/lib/supabase.js` (rozdělený do tří stringů). Na Vercelu musí
být tyto dvě `VITE_*` proměnné nastavené v Project Settings → Environment Variables.

### Edge funkce (Supabase secrets) — viz [04-edge-funkce-a-ai.md](04-edge-funkce-a-ai.md)
`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`,
`RESEND_API_KEY`, volitelně `AI_MODEL`, `AI_MAX_TOKENS`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS`, `NOTIFY_WEBHOOK_SECRET`.

### Offline skripty (předávané inline na příkazové řádce, ne v `.env.local`)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `USDA_API_KEY`.

### `supabase/config.toml`
`project_id = "food-tracker"` (jen lokální jméno CLI, **ne** remote ref). Nastavuje
`verify_jwt = false` pro `delete-client`, `generate-comment`, `generate-all-comments` (auth řeší
`requireTrainer` v kódu).

---

## Lokální vývoj

```bash
npm install
# .env.local: doplň VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY
npm run dev        # Vite dev server na :5173
```
`.claude/launch.json` definuje dev server (`npm run dev`, port 5173) pro Claude Code preview.

## Kde co „leží" (rychlá orientace pro obnovu)

| Věc | Kde |
|---|---|
| Zdroják frontendu | `src/` (git) |
| Schema DB | `supabase/migrations/001…030` (git) |
| Edge funkce | `supabase/functions/` (git) |
| Persona AI | `supabase/functions/_shared/styleGuide.ts` (git) |
| Seed data potravin | `data/*.jsonl`, `data/*.tsv` (git, čtyři curated) + reprodukovatelné dumpy (gitignored) |
| Anon key + URL | `.env.local` (lokálně) + Vercel env + `src/lib/supabase.js` |
| Service role / API klíče | **jen** Supabase secrets a lokální shell — nikde v gitu |
| Produkční data klientek | Supabase Postgres (projekt `uxffnpajkhcvtwzsmrcl`) |
| Hosting | Vercel (`jaknazdravetelo.vercel.app`) |
