# 02 — Datový model (Postgres / Supabase)

Vše ve schématu `public`. **RLS je zapnuté na všech tabulkách.** Schéma je definované 30 migracemi
v `supabase/migrations/001…030` — ne v žádném samostatném SQL dumpu. Migrace se pouští **v pořadí**.

Autorizaci řeší RLS + helper `public.is_trainer()` (SECURITY DEFINER, vrací true, pokud má volající
v `profiles` řádek s `role='trainer'`; jako DEFINER obchází RLS na `profiles`, aby nevznikla rekurze).

---

## Tabulky

### `profiles` (001; rozšířeno 004, 010, 025)
1:1 s `auth.users`. Vlastník řádku: `id = auth.uid()`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK, FK `auth.users(id) on delete cascade` |
| `email` | text | not null |
| `display_name` | text | not null, default `''` |
| `role` | text | not null, default `'client'`, check in (`client`,`trainer`) |
| `goal_kcal` | int | default 2000 |
| `goal_protein` | int | default 100 |
| `goal_carbs` | int | default 220 |
| `goal_fat` | int | default 80 |
| `goal_fiber` | int | default 30 |
| `created_at` | timestamptz | default `now()` |
| `initial_weight` | real | (004) nullable |
| `target_weight` | real | (010) nullable |
| `height` | real | (010) nullable |
| `age` | integer | (010) nullable |
| `status` | text | (025) default `'active'`, check in (`active`,`archived`) |

Index: `idx_profiles_status on profiles(status) where role='client'`.
Řádek se **nevytváří klientem** — vzniká přes trigger `handle_new_user()` (viz níže).

### `diary_days` (001)
Jeden řádek na (uživatel, datum). Vlastník: `user_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `user_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `date` | date | not null |
| `created_at` | timestamptz | default `now()` |
| — | — | `unique(user_id, date)` |

Index: `idx_diary_days_user_date on (user_id, date)`.

### `diary_entries` (001; rozšířeno 009, 015, 016, 030)
Položky jídel. Vlastnictví nepřímé přes `day_id → diary_days.user_id`.
**Každý řádek nese vlastní snímek výživy** (kcal + makra) — edit potraviny v `foods` se sem
záměrně nepropaguje.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `day_id` | uuid | not null, FK `diary_days(id) on delete cascade` |
| `meal_id` | text | not null, check in (`breakfast`,`snack1`,`lunch`,`snack2`,`dinner`,`supplements`) |
| `name` | text | not null |
| `brand` | text | not null, default `''` |
| `grams` | int | not null |
| `display_amount` | text | nullable (např. „2 plátky", „250 ml") |
| `kcal` | real | not null |
| `protein` | real | not null |
| `carbs` | real | not null |
| `fat` | real | not null |
| `fiber` | real | not null, default 0 |
| `sort_order` | int | default 0 |
| `created_at` | timestamptz | default `now()` |
| `created_by` | uuid | (009) nullable, bez FK — kdo položku vytvořil (trenér vs. klientka) |
| `food_id` | text | (015) FK `foods(id) on delete set null` |
| `unit` | text | (016) not null, default `'g'`, check in (`g`,`ml`) |
| `group_id` | uuid | (030) nullable — spojuje řádky jednoho uloženého jídla |
| `group_name` | text | (030) nullable — denormalizovaný název uloženého jídla |

Indexy: `idx_diary_entries_day(day_id)`, `diary_entries_food_id_idx(food_id)`, `idx_diary_entries_group(group_id)`.

### `meal_notes` (001)
Osobní poznámka klientky k jídlu. Vlastnictví přes `day_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `day_id` | uuid | not null, FK `diary_days(id) on delete cascade` |
| `meal_id` | text | not null |
| `note_text` | text | not null, default `''` |
| `created_at` / `updated_at` | timestamptz | default `now()` |
| — | — | `unique(day_id, meal_id)` |

### `trainer_comments` (001)
Komentář trenéra nebo AI k jídlu. Zápis dělá trenér/AI, čte klientka svůj.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `day_id` | uuid | not null, FK `diary_days(id) on delete cascade` |
| `meal_id` | text | not null |
| `comment_text` | text | not null |
| `author` | text | not null, default `'trainer'`, check in (`trainer`,`ai`) |
| `created_at` / `updated_at` | timestamptz | default `now()` |
| — | — | `unique(day_id, meal_id)` |

Index: `idx_trainer_comments_day(day_id)`. Na `unique(day_id,meal_id)` se upsertuje (`onConflict`).

### `ai_comment_log` (001)
Audit tokenů + surová odpověď od Claude. **Zároveň slouží jako denní počítadlo rate-limitu.**

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `day_id` | uuid | not null, FK `diary_days(id) on delete cascade` |
| `meal_id` | text | not null |
| `prompt_tokens` / `completion_tokens` | int | nullable |
| `model` | text | nullable |
| `raw_response` | text | nullable |
| `created_at` | timestamptz | default `now()` |

### `weight_entries` (004)
Váha. Vlastník: `user_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `weight` | real | not null |
| `date` | date | not null |
| `created_at` | timestamptz | default `now()` |
| — | — | `unique(user_id, date)` |

Index: `idx_weight_entries_user_date on (user_id, date)`.

### `goal_history` (005; rozšířeno 023)
Historizované denní cíle (aby minulé dny nezměnily hodnocení při pozdější změně cíle). Vlastník: `user_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `goal_kcal` | int | not null |
| `date` | date | not null |
| `created_at` | timestamptz | default `now()` |
| `goal_protein` | int | (023) nullable |
| `goal_carbs` | int | (023) nullable |
| `goal_fat` | int | (023) nullable |
| `goal_fiber` | int | (023) nullable |
| — | — | `unique(user_id, date)` |

Index: `idx_goal_history_user_date on (user_id, date)`. Čtení: poslední řádek s `date <= cílové_datum`.

### `activity_entries` (006; rozšířeno 007)
Zápis pohybu. Vlastnictví přes `day_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `day_id` | uuid | not null, FK `diary_days(id) on delete cascade` |
| `name` | text | not null |
| `duration` | int | not null (minuty) |
| `kcal_burned` | real | not null, default 0 |
| `sort_order` | int | default 0 |
| `created_at` | timestamptz | default `now()` |
| `note` | text | (007) default `''` |

Index: `idx_activity_entries_day(day_id)`.

### `foods` (011; rozšířeno 014, 015)
Globální databáze potravin (seed z USDA/OFF/KT + ruční/uživatelské). Vlastník: `created_by` (nullable).

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | text | PK (string id — KT slug / `user_…` / `usda_…`) |
| `title` | text | not null |
| `slug` | text | nullable |
| `kcal`,`protein`,`carbs`,`fat`,`fiber`,`sugar`,`salt`,`saturated_fat` | numeric | nullable (na 100 g/ml) |
| `category`,`brand`,`ean` | text | nullable |
| `default_grams` | numeric | nullable (typická porce) |
| `portions` | jsonb | nullable — `[{"label":…,"grams":…}]` |
| `source` | text | default `'usda'` (`usda`\|`off`\|`manual`\|`user`) |
| `confidence` | smallint | default 2 (1=ruční, 2=USDA, 3=OFF, 4=AI) |
| `raw` | jsonb | nullable (surová data ze zdroje) |
| `created_at` | timestamptz | default `now()` |
| `is_liquid` | boolean | (014) default false |
| `status` | text | (015) default `'approved'`, check in (`approved`,`pending`,`rejected`) |
| `created_by` | uuid | (015) FK `profiles(id) on delete set null` |
| `approved_by` | uuid | (015) FK `profiles(id) on delete set null` |
| `approved_at` | timestamptz | (015) nullable |

Rozšíření: `pg_trgm` + `unaccent`. Indexy: `foods_title_trgm_idx` (gin trgm), `foods_title_lower_idx`,
`foods_title_unaccent_trgm_idx` (gin trgm nad `immutable_unaccent(title)`), `foods_status_created_by_idx(status, created_by)`.

### `invite_codes` (018)
Jednorázové zvací kódy. Vlastník: `trainer_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `code` | text | unique, not null |
| `trainer_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `client_name` | text | default `''` |
| `created_at` | timestamptz | default `now()` |
| `expires_at` | timestamptz | default `now() + interval '7 days'` |
| `used_by` | uuid | FK `profiles(id) on delete set null` |
| `used_at` | timestamptz | nullable |

Index: `idx_invite_codes_code(code)`. Konzumuje trigger `handle_new_user()` (019).

### `meal_templates` (021)
Uložená jídla („Moje jídla"). Vlastník: `user_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `name` | text | not null |
| `items` | jsonb | not null — pole `{name, food_id, grams, unit, kcal, protein, carbs, fat, fiber, brand, display_amount}` |
| `total_kcal` | real | default 0 |
| `created_at` | timestamptz | default `now()` |

Index: `idx_meal_templates_user(user_id)`.

### `food_portion_suggestions` (022)
Návrhy porcí od klientek ke schváleným potravinám. Vlastník: `suggested_by`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `food_id` | text | not null, FK `foods(id) on delete cascade` |
| `suggested_by` | uuid | not null, FK `profiles(id) on delete cascade` |
| `suggested_portions` | jsonb | not null |
| `status` | text | default `'pending'`, check in (`pending`,`approved`,`rejected`) |
| `created_at` / `updated_at` | timestamptz | default `now()` |
| `reviewed_by` | uuid | FK `profiles(id) on delete set null` |
| `reviewed_at` | timestamptz | nullable |

Indexy: partial unique `… on (food_id, suggested_by) where status='pending'`; `… on (status, created_at desc)`.

### `announcements` (026)
Hromadné vzkazy od trenéra. Vlastník: `trainer_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `id` | uuid | PK |
| `trainer_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `body` | text | not null |
| `created_at` | timestamptz | default `now()` |

### `announcement_recipients` (026; realtime 027)
Doručení vzkazu konkrétní klientce. Vlastník: `user_id`.

| Sloupec | Typ | Poznámka |
|---|---|---|
| `announcement_id` | uuid | not null, FK `announcements(id) on delete cascade` |
| `user_id` | uuid | not null, FK `profiles(id) on delete cascade` |
| `dismissed_at` | timestamptz | nullable |
| — | — | PK `(announcement_id, user_id)` |

Index: partial `… on (user_id) where dismissed_at is null`. Migrace 027 přidává tabulku do
publikace `supabase_realtime` (push popupů klientkám).

---

## RPC funkce

| Funkce | Argumenty | Vrací | Security | Popis |
|---|---|---|---|---|
| `is_trainer()` | — | boolean | **DEFINER**, STABLE, sql | Je volající trenér? Centrální RLS helper. (002) |
| `handle_new_user()` | trigger | trigger | **DEFINER**, plpgsql | Trigger na `auth.users`. 019: **vyžaduje platný `invite_code`** z `raw_user_meta_data`, ověří proti `invite_codes` (nepoužitý, neexpirovaný, `for update`), vytvoří profil, označí kód použitý. Bez kódu vyhodí P0001. |
| `search_foods(q text, lim int default 15)` | q, lim | `setof foods` | INVOKER, STABLE, sql | Fuzzy trigram hledání (unaccent+lower). Řadí češtinu nad USDA, priorita zdroje manual/user > off+brand > off > usda, penalizuje USDA „title, s čárkami". Filtruje viditelnost (`approved` OR `created_by=auth.uid()` OR `is_trainer()`). Redefinováno 012→013→015→**020 (živá verze)**. |
| `immutable_unaccent(text)` | text | text | IMMUTABLE, sql | (013) Wrapper nad `public.unaccent` pro trigram index. |
| `get_recent_foods(p_meal_id text, p_days int=30, p_limit int=20, p_target_user_id uuid=null)` | 4 | table(…) | **DEFINER**, STABLE, `search_path=public`, plpgsql | (017) Nedávno použité potraviny pro one-click přidání. Když je `p_target_user_id` zadané, volající **musí být trenér** (jinak exception). Agreguje `diary_entries` a přepočte makra zpět na 100 g. |
| `protect_profile_privileged_columns()` | trigger | trigger | **DEFINER**, plpgsql | (028) BEFORE UPDATE na `profiles`; blokuje změnu `role`/`status`, pokud volající není trenér. |

## Triggery

| Trigger | Tabulka | Kdy | Funkce |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | AFTER INSERT per row | `handle_new_user()` |
| `protect_profile_privileged_columns` | `public.profiles` | BEFORE UPDATE per row | `protect_profile_privileged_columns()` |

---

## RLS politiky (shrnutí)

Formát: **kdo** může **co** a za jaké podmínky. „trenér" = `is_trainer()`.

- **profiles** — klient SELECT/UPDATE vlastní (`auth.uid()=id`); trenér SELECT/UPDATE všechny. Bez INSERT (řádky tvoří trigger). Trigger 028 navíc pustí změnu `role`/`status` jen trenérovi.
- **diary_days** — klient `for all` kde `user_id=auth.uid()`; trenér SELECT všechny + INSERT.
- **diary_entries** — klient `for all` přes vlastnictví rodičovského dne; trenér SELECT/INSERT/UPDATE/DELETE.
- **meal_notes** — klient `for all` přes den; trenér SELECT/INSERT/UPDATE/DELETE.
- **trainer_comments** — trenér `for all`; klient SELECT kde rodičovský den patří jemu. (Zápis jen trenér/AI.)
- **ai_comment_log** — jen trenér SELECT. Zápis dělají edge funkce přes service role (obchází RLS).
- **weight_entries** — klient SELECT/INSERT/UPDATE vlastní; trenér SELECT/INSERT/UPDATE. (DELETE nikdo.)
- **goal_history** — klient SELECT/INSERT/UPDATE vlastní; trenér SELECT (005) + INSERT/UPDATE (024).
- **activity_entries** — klient SELECT/INSERT/DELETE přes den; trenér SELECT/INSERT/UPDATE/DELETE. (Klient bez UPDATE.)
- **foods** — SELECT kde `status='approved' OR created_by=auth.uid() OR is_trainer()`; klient INSERT/UPDATE vlastní **pending**; trenér INSERT/UPDATE; DELETE jen trenér.
- **invite_codes** (finální 029) — SELECT/INSERT: `is_trainer() AND trainer_id=auth.uid()`; DELETE navíc `used_by is null`.
- **meal_templates** — SELECT `user_id=auth.uid() OR is_trainer()`; INSERT/UPDATE/DELETE vlastní.
- **food_portion_suggestions** — SELECT vlastní nebo trenér; INSERT vlastní pending; UPDATE vlastní-pending nebo trenér; DELETE vlastní-pending nebo trenér.
- **announcements** — trenér `for all`; klient SELECT kde existuje jeho řádek v `announcement_recipients`.
- **announcement_recipients** — trenér `for all`; klient SELECT/UPDATE vlastní řádky (pro `dismissed_at`).

---

## GRANTy (⚠️ důležité pro rebuild)

Od **30.10.2026** Supabase vyžaduje **explicitní `grant … to authenticated`** u každé nové tabulky
v `public` — RLS sama o sobě nestačí, tabulka musí být roli `authenticated` vůbec „vidět".

- **Migrace 026** zavedla vzor: `grant select, insert, update, delete on public.announcements to authenticated;` (a totéž pro `announcement_recipients`).
- **Migrace 029** doplnila granty pro **všechny starší tabulky** (profiles, diary_days, diary_entries, meal_notes, trainer_comments, ai_comment_log, weight_entries, goal_history, activity_entries, foods, invite_codes, meal_templates, food_portion_suggestions) a zpřísnila politiky `invite_codes`.
- RPC granty: `search_foods`, `immutable_unaccent`, `get_recent_foods` — každá `grant execute … to authenticated`.
- **Žádné granty pro `anon`** (nepřihlášený nemá k datům přístup).

> Když budeš přidávat novou tabulku, **nezapomeň grant** — jinak appka dostane prázdno / „permission denied", i když je RLS správně.

---

## Pořadí a závislosti migrací

Pouštět **striktně 001 → 030**. Kritické závislosti:

1. **001** šest základních tabulek. **002** `is_trainer()` (potřebují ho skoro všechny pozdější politiky) + zapne RLS. **003** signup trigger.
2. **004/005/006** váha, cíle, aktivity. **007** alter aktivit. **008** trenérské write politiky (potřebují `is_trainer`). **009/010** alter diary/profiles.
3. **011** `foods` + `pg_trgm`. **012** první `search_foods`. **013** `unaccent` + `immutable_unaccent` + index — **tvrdá závislost pro 014, 015, 020**. **015** approval + FK `diary_entries.food_id` + foods RLS + redefinice `search_foods`. **016/017** unit / `get_recent_foods`.
4. **018** `invite_codes`. **019** přepis `handle_new_user()` na povinný invite (potřebuje 018). **020** finální `search_foods` (potřebuje 013).
5. **021** šablony. **022** návrhy porcí (FK na foods). **023** rozšíří `goal_history`. **024** trenérský zápis do goal_history. **025** `profiles.status`.
6. **026** oznámení (+ první explicitní granty). **027** realtime publikace. **028** ochranný trigger na profiles (potřebuje `status` z 025). **029** doplnění grantů + zpřísnění invite_codes. **030** `group_id`/`group_name` na diary_entries.

**Historická past (už vyřešená):** kdysi existovaly dva soubory se stejným číslem `013_*`
(`search_foods_ranking` + `unaccent_search`), což rozbíjelo `db reset`. Sloučeny do jediného
`013_search_foods_ranking.sql`. Při čistém rebuildu tohle už neřešíš.
