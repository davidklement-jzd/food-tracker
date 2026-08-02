# 04 — Edge funkce a AI integrace

Supabase Edge Functions běží v **Deno** (TypeScript), přes `Deno.serve`. Čtyři funkce:
`generate-comment`, `generate-all-comments`, `delete-client`, `notify-new-client`. První tři sdílejí
`_shared/http.ts`; první dvě navíc `_shared/styleGuide.ts` (persona).

Auth model tří „trenérských" funkcí: v `config.toml` mají `verify_jwt = false`, takže gateway
nezahodí request; **autorizaci řeší kód uvnitř** přes `requireTrainer()`. (`notify-new-client` v
configu není → default `verify_jwt = true`, je to server-to-server webhook.)

---

## Sdílená infrastruktura — `_shared/http.ts`

### AI konfigurace (jediný zdroj pravdy)
```
AI_MODEL      = Deno.env.get("AI_MODEL")      ?? "claude-sonnet-4-6"
AI_MAX_TOKENS = Deno.env.get("AI_MAX_TOKENS") ?? "220"
AI_TIMEOUT_MS = 30000
AI_MAX_RETRIES = 2   // až 3 pokusy
```

> **⚠️ Oprava paměťové poznámky:** Model **NENÍ** natvrdo zapsaný na čtyřech místech. Čte se z env
> `AI_MODEL` s **defaultním literálem `"claude-sonnet-4-6"`**. Když model vyřadí, funkce dostane 404,
> který je klasifikovaný jako `permanent` (neopakuje se) → generování tiše vrátí „0 komentářů".
> Řešení při výpadku modelu: nastavit env `AI_MODEL` na aktuální ID a redeploynout (nebo jen změnit secret).

### Volání Anthropic
```
POST https://api.anthropic.com/v1/messages
headers: x-api-key: <ANTHROPIC_API_KEY>, anthropic-version: 2023-06-01
body: {
  model: AI_MODEL,
  max_tokens: AI_MAX_TOKENS,
  system: [{ type:"text", text: SYSTEM_PROMPT, cache_control:{ type:"ephemeral" } }],
  messages: [{ role:"user", content: userPrompt }]
}
```
- **Prompt caching** na systémovém promptu (`cache_control: ephemeral`) — persona je velká, cache šetří tokeny.
- **Retry**: transient chyby (429/5xx/síť/timeout) → exponenciální backoff `500*2^attempt`.
  Permanentní (400/401/403/404) se neopakují (404 = vyřazený model).
- Ošetření `stop_reason` (odmítnutí / max_tokens / prázdno). `stripAiReasoning()` + `trimToLastSentence()`
  čistí výstup; **tvrdý strop 250 znaků**.

### CORS
`corsHeadersFor(req)` echoes `Origin`, pokud je v allow-listu (`http://localhost:5173`,
`http://localhost:4173` + comma-separated env `ALLOWED_ORIGINS`), jinak první povolený origin.
Metody `POST, OPTIONS`, headery `authorization, x-client-info, apikey, content-type`, `Vary: Origin`.

### Autorizace — `requireTrainer(req, cors)`
Přečte Bearer token → ověří přes scoped anon klienta `auth.getUser()` → přes **service-role** admin
klienta potvrdí `profiles.role='trainer'`. Vrací `{userId, admin}` nebo hotový 401/403/500 Response.
Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Rate limit — `enforceAiDailyLimit`
Počítá dnešní řádky v `ai_comment_log` (UTC půlnoc) vs. cap (`AI_DAILY_LIMIT`, default 300).
Při dosažení vrací 429. Při chybě dotazu **fail-open** (raději pustí než zablokuje).

---

## `generate-comment`
- **Účel:** vygeneruje + uloží jeden AI komentář k jednomu jídlu. POST (OPTIONS ok, jinak 405).
- **Auth:** trenérský JWT (`requireTrainer`).
- **Body:** `{ day_id (uuid), meal_id (jen breakfast/snack1/lunch/snack2/dinner — NE supplements),
  client_name?, client_goals? }`.
- **Čte (service role):** `diary_days` řádek, všechny `diary_entries` dne (vč. `group_id/group_name`),
  `trainer_comments`, `meal_notes` pro dané jídlo. Cíle dne přes `resolveGoalsForDate` (goal_history)
  → fallback `client_goals` → tvrdé defaulty (2000/100/220/80/30).
- **Zapisuje:** upsert `trainer_comments` (`author:'ai'`, `onConflict day_id,meal_id`) + insert
  `ai_comment_log` (i při selhání). Vrací `{comment, id, tokens}` nebo 502.
- **Env:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  volitelně `AI_DAILY_LIMIT`, `AI_MODEL`, `AI_MAX_TOKENS`, `ALLOWED_ORIGINS`.

## `generate-all-comments`
- **Účel:** hromadně vygeneruje komentáře pro všechna komentovatelná jídla jednoho data napříč klientkami. POST.
- **Auth:** trenérský JWT.
- **Body:** `{ date (YYYY-MM-DD, regex), client_ids? (uuid pole; když chybí → všechny role='client') }`.
- **Logika:** pro každou klientku → najdi `diary_days` toho data → čti entries/comments/notes →
  vyřeš cíle → iteruj komentovatelná jídla, **přeskoč ta, co už komentář mají**, znovu ověř denní
  limit **uvnitř smyčky**, generuj + ulož, a každý nový komentář vlož do běžícího kontextu (další
  jídla vidí předchozí). Počítá `generated/skipped/failed`; vrací 502, když `generated=0 && skipped=0 && failed>0`
  (aby nevzniklo matoucí „0 komentářů").
- **Zapisuje:** stejně jako výše (per jídlo).
- **Env:** stejná sada.

## `delete-client`
- **Účel:** tvrdé smazání klientky (auth user → kaskáda přes FK smaže všechna data). POST.
- **Auth:** trenérský JWT.
- **Body:** `{ client_id (uuid) }`. Guardy: nelze smazat sebe (400); cíl musí existovat (404);
  cíl **nesmí mít `role='trainer'`** (403).
- **Akce:** `admin.auth.admin.deleteUser(client_id)` přes service role. Vrací `{success:true}`.
- **Env:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (bez Anthropic).

## `notify-new-client`
- **Účel:** spouští ji Supabase **Database Webhook** na INSERT do `profiles`; pošle trenérovi
  e-mail přes Resend. POST (jinak plain 405). Standalone — nepoužívá `_shared/http.ts`, není v `config.toml`.
- **Auth:** volitelný sdílený secret — když je env `NOTIFY_WEBHOOK_SECRET` nastavený, request musí
  poslat shodný header `x-notify-secret` (jinak 401); když není, kontrola se přeskočí (fail-open).
  **Nevolá `requireTrainer`.**
- **Body:** webhook payload `{record:{id}}`. Autoritativní data si čte z DB podle `record.id`
  (service role), **ne** z nedůvěryhodného payloadu; vše HTML-escapuje.
- **Čte:** `profiles.display_name, email, role`. Přeskočí, když nenajde nebo `role='trainer'`.
- **Posílá:** `POST https://api.resend.com/emails`, `Authorization: Bearer <RESEND_API_KEY>`,
  from `"Food Tracker <onboarding@resend.dev>"`, to **natvrdo** `dava.klement@gmail.com`,
  subject `"Nova klientka: <jméno>"`.
- **Env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, volitelně `NOTIFY_WEBHOOK_SECRET`.

---

## `_shared/styleGuide.ts` — persona trenéra

Jeden exportovaný `const SYSTEM_PROMPT` — velký český systémový prompt (~622 řádků, ~69 KB),
titul „Průvodce komentování jídelníčků – David Klement". Instruuje model psát krátké (max 3–4 věty /
250 znaků) komentáře ke jídlům Davidovým hlasem. Klíčová pravidla:
- vždy **vykání** (nikdy tykání), vždy **mužský rod 1. osoba** (trenér je muž),
- přátelský/hovorový tón,
- přesná pravidla o formulaci bílkovinového cíle podle denního %,
- „kalorický přepis" zmíněný **max 1× denně**,
- zakázaná slova (např. používat „základ", ne „jádro"),
- žádné rady na kompenzaci napříč dny.

Vedle leží snímek `styleGuide.baseline-2026-07-08.ts.bak` (záloha baseline stylu).

---

## Secrets — souhrn (kam co patří)

Tyto **NEJSOU v gitu** a musí se nastavit v **Supabase → Edge Functions → Secrets**:

| Secret | Používá | Povinný? |
|---|---|---|
| `ANTHROPIC_API_KEY` | generate-comment, generate-all-comments | ano (pro AI) |
| `SUPABASE_URL` | všechny | ano (Supabase je injectuje automaticky) |
| `SUPABASE_ANON_KEY` | requireTrainer | ano |
| `SUPABASE_SERVICE_ROLE_KEY` | všechny (obchází RLS) | ano |
| `RESEND_API_KEY` | notify-new-client | jen pro e-mail |
| `AI_MODEL` | http.ts | ne (default `claude-sonnet-4-6`) |
| `AI_MAX_TOKENS` | http.ts | ne (default 220) |
| `AI_DAILY_LIMIT` | rate limit | ne (default 300) |
| `ALLOWED_ORIGINS` | CORS | ne (produkční origin appky) |
| `NOTIFY_WEBHOOK_SECRET` | notify-new-client | doporučeno (jinak fail-open) |
