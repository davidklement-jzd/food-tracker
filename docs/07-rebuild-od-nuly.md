# 07 — Rebuild od nuly (krok za krokem)

Tenhle návod předpokládá, že **máš kód** (tento repo) a chceš appku znovu rozjet — buď na stávající
Supabase/Vercel, nebo na čistých účtech. Když kód nemáš vůbec, dokumenty 00–06 popisují systém tak,
aby ho šlo znovu napsat; tady jde o zprovoznění existujícího kódu.

Čti k tomu detaily: [02-datovy-model.md](02-datovy-model.md), [04-edge-funkce-a-ai.md](04-edge-funkce-a-ai.md),
[05-deploy-a-prostredi.md](05-deploy-a-prostredi.md).

---

## 0. Co si připrav (účty a klíče)

- **Supabase** projekt (nový nebo stávající `uxffnpajkhcvtwzsmrcl`).
- **Anthropic** API klíč (AI komentáře).
- **Resend** API klíč (e-mail „nová klientka") — volitelné.
- **USDA** API klíč — jen když budeš seedovat potraviny z USDA.
- **Vercel** účet (hosting).
- Lokálně: **Node** (18+), **Supabase CLI**, `npm`.

---

## 1. Založ / naklonuj Supabase projekt

```bash
supabase login
supabase link --project-ref <TVŮJ_REF>   # nový nebo uxffnpajkhcvtwzsmrcl
```

## 2. Aplikuj migrace (schema + RLS + granty)

```bash
supabase db push
```
Spustí `supabase/migrations/001…030` **v pořadí**. Pořadí a závislosti viz
[02-datovy-model.md](02-datovy-model.md#pořadí-a-závislosti-migrací). Kontrola po aplikaci:
- existuje 16 tabulek, RLS zapnuté na všech;
- RPC `is_trainer`, `search_foods`, `get_recent_foods`, `immutable_unaccent`;
- triggery `on_auth_user_created`, `protect_profile_privileged_columns`;
- rozšíření `pg_trgm`, `unaccent`;
- **granty `to authenticated` na všech tabulkách** (jinak appka dostane „permission denied").

## 3. Vytvoř prvního trenéra

Registrace přes appku vyžaduje invite kód (trigger `handle_new_user`), a invite kódy tvoří jen
trenér → **slepice/vejce**. První trenér se musí založit ručně:
1. Vytvoř uživatele v Supabase Auth (Dashboard → Authentication → Add user), nebo se zaregistruj
   a dočasně obejdi trigger.
2. V tabulce `profiles` nastav jeho `role = 'trainer'`.

> Bez trenéra nejde generovat invite kódy → nejde registrovat žádná klientka. Tenhle krok nesmíš vynechat.

## 4. Nasaď edge funkce

```bash
supabase functions deploy generate-comment
supabase functions deploy generate-all-comments
supabase functions deploy delete-client
supabase functions deploy notify-new-client
```

## 5. Nastav Supabase secrets

V Supabase → Edge Functions → Secrets (nebo `supabase secrets set`):
```
ANTHROPIC_API_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # obvykle injectováno, ověř
RESEND_API_KEY=...              # volitelné
NOTIFY_WEBHOOK_SECRET=...       # doporučeno
# volitelné laděné:
AI_MODEL=claude-sonnet-4-6
AI_MAX_TOKENS=220
AI_DAILY_LIMIT=300
ALLOWED_ORIGINS=https://jaknazdravetelo.vercel.app
```
Kompletní tabulka v [04-edge-funkce-a-ai.md](04-edge-funkce-a-ai.md#secrets--souhrn-kam-co-patří).

## 6. (Volitelné) Database webhook pro e-mail

Supabase → Database → Webhooks: na **INSERT** do `public.profiles` volej funkci `notify-new-client`.
Přidej header `x-notify-secret` = hodnota `NOTIFY_WEBHOOK_SECRET`.

## 7. Naseeduj databázi potravin

Když migruješ existující data, prostě je přenes. Když stavíš čistě:
```bash
# 1) curated seedy (jsou v gitu)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-foods-to-supabase.mjs data/fastfood-cz.jsonl
# … a stejně alcohol-cz.jsonl, sweets-cz.jsonl
# 2) volitelně USDA/OFF/KT (viz 06-skripty-a-data.md) — velké, časově náročné
```
Bez potravin appka funguje, jen bude prázdné vyhledávání. Uživatelé si můžou tvořit vlastní potraviny.

## 8. Nastav a nasaď frontend (Vercel)

1. `.env.local` a Vercel env:
   ```
   VITE_SUPABASE_URL=https://<REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```
2. **Uprav natvrdo zapsaný anon key + URL** v `src/lib/supabase.js` (je rozdělený do tří stringů),
   pokud měníš projekt.
3. **Uprav CSP** v `vercel.json` — `connect-src` musí obsahovat nový `https://<REF>.supabase.co`
   (+ `wss://`), jinak appka nesmí volat backend.
4. Napoj repo na Vercel, `git push` na `main` → build `vite build`.

## 9. Smoke test

- Registrace klientky přes `?invite=KÓD` (kód vygeneruj jako trenér v dashboardu).
- Přidání jídla (hledání, sken kódu), zápis váhy, aktivita.
- Trenér: dashboard, ruční komentář, **AI komentář** (ověří Anthropic klíč + model), hromadné komentování.
- Ověř, že klientka vidí komentář a hromadný vzkaz (realtime popup).

---

## Pořadí je důležité

```
Supabase projekt → migrace → první trenér → edge funkce → secrets → (webhook)
     → seed potravin → frontend env + CSP + supabase.js → deploy → smoke test
```

## Nejčastější chyby při rebuildu

1. **Chybí grant `to authenticated`** na tabulce → „permission denied" i při správném RLS. (viz [02](02-datovy-model.md#granty--důležité-pro-rebuild))
2. **Nezměněný CSP / anon key** po migraci projektu → appka nevolá backend.
3. **Zapomenutý deploy edge funkcí** (push na main je nenasadí).
4. **Vyřazený `AI_MODEL`** → AI tiše vrací „0 komentářů" (404 = permanent). Nastav aktuální model.
5. **Chybí první trenér** → nejde vytvořit invite → nejde registrovat.
6. **Migrace mimo pořadí** → 013 (unaccent) musí být před 014/015/020.
