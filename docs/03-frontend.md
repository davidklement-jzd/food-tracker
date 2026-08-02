# 03 — Frontend (React 19 + Vite)

Čistý JavaScript (žádný TS). SPA bez routeru — navigace je React stav v `App.jsx`. Jeden Supabase
klient pro celou appku. Jazyk UI: čeština.

Kořen: `src/`.

---

## App shell & navigace

### `src/main.jsx`
Vstupní bod. `createRoot` → `<StrictMode><AuthProvider><App/></AuthProvider>`. Před prvním
renderem přečte `localStorage.large_text === '1'` a přidá třídu `large-text` na
`document.documentElement` (na `<html>`, ne `<body>` — Chrome Android ignoruje `text-size-adjust`
na body), aby nedošlo k probliknutí malého písma.

### `src/App.jsx` (~476 řádků) — celý navigační systém
**Bez routeru.** Vše je React stav.

- Konstanta `MEALS`: `breakfast` (Snídaně), `snack1` (Dopolední svačina), `lunch` (Oběd),
  `snack2` (Odpolední svačina), `dinner` (Večeře), `supplements` (label **„Kalorický dluh"** —
  ruční účetní sekce, ne reálné jídlo). Stejné pole je duplikované v `TrainerClientDiary.jsx`
  a (bez supplements) v `CopyMealModal.jsx`.
- Lokální date helpery `toDateStr`/`todayStr`/`formatDate` (duplikované napříč soubory místo importu z `utils/dates`).
- Klíčový stav: `selectedDate` (YYYY-MM-DD, default dnes), `modalMeal`, `trainerView`
  (`dashboard`|`client`|`myDiary`), `selectedClient`, `currentView` (`diary`|`settings`|`analysis`|`foods-db`), `showUserMenu`.
- **Navigační brány v pořadí:**
  1. `authLoading` → splash.
  2. `recoveryMode` (z AuthContext) → `ResetPasswordPage`.
  3. `!user` → `AuthPage`.
  4. `isTrainer && trainerView !== 'myDiary'` → trenérský shell (taby Klientky / Můj jídelníček) → `TrainerDashboard` nebo `TrainerClientDiary`, případně sdílené `SettingsPage`/`AnalysisPage`/`FoodsDatabasePage`.
  5. Jinak klientský deník (používá ho i trenér pro „Můj jídelníček").
- Klientský deník skládá: `AnnouncementPopup`, popup týdenního přehledu, header (`SearchBar` pro
  klientky), navigaci data, `MealSection` × 6, `ActivitySection`, sidebar (`StreakBadge`,
  `DailySummary`, `WeightTracker`) + modaly `FoodSearchModal`, `ActivitySearchModal`, uložení
  šablony, `CopyMealModal`.
- **Signal pattern** (vynucení přepočtu hooku bez reloadu): `todayEntrySignal` = počet dnešních
  položek (do `useStreak`, aby medaile reagovala hned); `weightSignal` (inkrementuje
  `WeightTracker.onSaved`, do `useWeightReminder`, aby banner zmizel hned).
- **Popup týdenního přehledu:** při mountu, pokud není trenér a přehled není prázdný, kontroluje
  `localStorage[weeklySeen:{userId}:{prevWeek.start}]`; zobrazí 1× za nový týden.

`App.css`, `index.css` — styly.

---

## Auth

### `src/contexts/AuthContext.jsx`
`AuthProvider` + `useAuth()`, obaluje `supabase.auth`.
- Stav: `session`, `profile`, `loading`, `recoveryMode`.
- Mount: `getSession()` → `fetchProfile`; subscribe `onAuthStateChange`. Event `PASSWORD_RECOVERY` → `recoveryMode=true`.
- `fetchProfile(userId)` → `profiles` select `*` where `id=userId` (`.single()`).
- Exportuje: `signUp(email, password, displayName, inviteCode)` (posílá `display_name` + `invite_code`
  v `options.data`), `signIn`, `signOut`, `resetPasswordForEmail`, `updatePassword`,
  `updateProfile(updates, oldProfileSnapshot)`.
- `updateProfile` po updatu `profiles` zavolá `logGoalChange(...)` (historizace cílů).
- Derived `isTrainer: profile?.role === 'trainer'`.

### `src/components/AuthPage.jsx`
Login / registrace / zapomenuté heslo (jedna komponenta, tři módy). Čte `?invite=KÓD` z URL,
přepne na registraci a vyčistí URL (`history.replaceState`). Registrace **vyžaduje invite kód**;
mapuje generickou Supabase chybu „Database error saving new user" (z DB triggeru) na hlášku
„neplatný/expirovaný/použitý kód".

### `src/components/ResetPasswordPage.jsx`
Zobrazí se v `recoveryMode`. Validace ≥6 znaků + shoda, `updatePassword`, pak `signOut`.

---

## Hooky (`src/hooks/`)

| Hook | Účel | Tabulky / RPC / funkce | Klíčová logika |
|---|---|---|---|
| `useSupabaseDiary` | Vlastní deník klientky pro jeden den; CRUD položek + poznámek; čte trenérské komentáře | `diary_days`, `diary_entries`, `meal_notes`, `trainer_comments`, `auth.getUser()` | Exportuje `DIARY_ENTRY_SELECT`, `buildDiaryEntry`, `isLikelyLiquid`. `ensureDayId` upsertuje `diary_days` při prvním zápisu. |
| `useTrainerData` | Trenérské funkce: seznam klientek + jejich deník + generování komentářů | `profiles`, `diary_days`, `diary_entries`, `meal_notes`, `trainer_comments`, edge fn `generate-comment` | Exportuje `useClientList(status)`, `setClientStatus`, `useClientDiary`. `saveComment` (text ≤250, `author:'trainer'`), `generateAiComment` (`author:'ai'`). |
| `useActivityDiary` | Aktivity pro den | `diary_days`, `activity_entries` | `addActivity`, `remove`, `update`. |
| `useGoalHistory` | Historizované denní cíle | `goal_history` | `getGoalForDate`, `getAllGoalsForDate`. **Pravidlo:** dnes/budoucnost → profil; minulé dny → poslední řádek ≤ datum s ne-null hodnotou; když žádný, tak **nejstarší** zaznamenaná hodnota (nikdy aktuální profil). Fallback na kcal-only, když 5-sloupcový select selže (migrace 023 neaplikovaná). |
| `useWeeklySummary` | Shrnutí posledního uzavřeného týdne vs. cíle + váha | `diary_days` s nested `diary_entries(...)`, `weight_entries` | Denní součty, % cíle (kcal 90–110 % zelená; makra různě), počet zapsaných dní, změna váhy, porovnání s předchozím týdnem. |
| `useCalorieHistory` | All-time denní kcal pro graf Analýzy | `diary_days`, `diary_entries` přes **`fetchAllRows`** | Stránkuje (obchází 1000-řádkový cap). |
| `useWeightTracker` | Váha pro datum + celá historie | `weight_entries` (upsert `user_id,date`) | `saveWeight` vždy pod **dnešní** datum (nelze zpětně datovat). |
| `useWeightReminder` | Zda upozornit na chybějící váhu | `weight_entries` | `overdue` jen když váha existuje a je ≥7 dní stará (`THRESHOLD_DAYS=7`). Nové bez váhy se nešťouchají. |
| `useStreak` | Série za pravidelné zapisování | `diary_days` s `diary_entries!inner(id)` | Série „žije" přes dnešek (platná, když poslední log je dnes/včera). Přepočet na `refreshSignal`. |
| `useTemplates` | Uložená jídla („Moje jídla") | `meal_templates` | `saveTemplate(name, entries)`. |
| `useRecentFoods` | Nedávné potraviny do modalu | RPC `get_recent_foods` | `enabled:false` pro `supplements`. `targetUserId` pustí trenéra k recentům klientky. |
| `useLocalStorage` | Generický JSON stav v localStorage | — | Utilita. |

---

## Komponenty (`src/components/`)

| Komponenta | Účel |
|---|---|
| `SearchBar` | Header rychlé hledání (klientky); debounce, přidá rovnou do **breakfast**. |
| `DailySummary` | Sidebar: kruh kcal + makro bary + tekutiny (ml); barvy 90–110 % zelená / >110 % červená / jinak oranžová. |
| `MealSection` | Seznam položek jednoho jídla; inline edit gramáže/porce, poznámka, kopírování/uložení šablony, sbalitelná uložená jídla, zobrazení trenérského komentáře. |
| `ActivitySection` | Seznam aktivit s inline editem minut (přepočet kcal). |
| `ActivitySearchModal` | Hledání ve statickém `ACTIVITIES_DB`, výběr délky. |
| `FoodSearchModal` | Hlavní modal přidání potraviny: hledání, recents, šablony, porce, vytvoření nové, sken kódu. |
| `BarcodeScanner` | Lazy kamera; native `BarcodeDetector` s fallbackem na zxing-js. |
| `PortionsEditor` | Reusable editor porcí; exportuje `cleanPortions` (validace). |
| `CopyMealModal` | Kopie jídla z jednoho z posledních 7 dní; regeneruje `group_id`. |
| `WeightTracker` | Sidebar váha; editovatelné jen dnes; fallback `profile.initial_weight`. |
| `WeightReminderBanner` | Klientský banner „zvaž se"; dismiss per-den v localStorage. |
| `StreakBadge` | SVG medaile (bronz 1–6, stříbro 7–29, zlato 30–99, diamant 100+) + motivační text. |
| `WeeklySummary` | Render objektu z `useWeeklySummary` + ručně kreslený SVG sparkline váhy. |
| `TrainerComment` | Trenérský editor komentáře per jídlo (psát / generovat AI / editovat / smazat), 250 znaků. |
| `TrainerDashboard` | Trenérský home: seznam klientek, hromadné AI komentáře, invites, vzkazy, mazání. |
| `TrainerClientDiary` | Trenér prohlíží/edituje deník klientky + komentáře. |
| `AnalysisPage` | Chart.js grafy váhy + kalorií (sdílené klient/trenér). |
| `SettingsPage` | Profil + denní cíle (self nebo trenér-edituje-klientku). |
| `FoodsDatabasePage` | Sdílená DB potravin: procházení/tvorba/edit/schvalování + review návrhů porcí. |
| `AnnouncementPopup` | Klientský popup pro vzkazy trenéra; realtime + re-fetch při zviditelnění. |

### Velké komponenty — detail

**`MealSection.jsx`** — Grupuje položky do „render jednotek": samostatné potraviny vs. uložená
jídla (řádky se sdíleným `group_id` jako jedna sbalitelná položka se sečtenými makry; 🍽️ badge).
Inline edit: unit select nabízí g/ml + `portions`; `commitEdit` přeškáluje kcal/makra poměrem
`newGrams/oldGrams`. Marker položky vytvořené trenérem, když `entry.created_by !== ownerId`.

**`FoodSearchModal.jsx`** (~912 řádků) — Centrální UI přidání jídla. Debounce 300 ms → `searchSupabaseFoods`
(RPC `search_foods`). Views: recents, „Moje jídla" (přeškálování šablony s novým `group_id`),
výsledky hledání, detail produktu (množství × unit g/ml/`portion_N`/`serving`, živý náhled maker),
tvorba nové potraviny (`id: user_${crypto.randomUUID()}`, `source:'user'`, `confidence:4`, `status:'pending'`).
Sken kódu → `lookupByEan`. Návrhy porcí → `food_portion_suggestions`.

**`TrainerDashboard.jsx`** (~897 řádků) — Taby aktivní/archivované klientky. Multi-select klientek
+ chipy posledních 7 dní → hromadné AI komentáře přes edge fn `generate-all-comments` (per klientka×datum).
`buildBulkSummary` batch-dotazuje `diary_days`, `diary_entries` (přes `fetchAllRows`), `meal_notes`,
`weight_entries`, `goal_history` → tabulka kcal/váha/poznámka/neaktivita. Invites přes `invite_codes`
(client-side `generateInviteCode` z `crypto.getRandomValues`). Vzkazy → `announcements` + `announcement_recipients`.
Mazání → edge fn `delete-client`.

**`TrainerClientDiary.jsx`** (~450 řádků) — Trenér edituje den klientky. „Okomentovat celý den"
iteruje jídla bez komentáře a volá `generateAiComment` (přeskočí `supplements`). Sub-views
`settings`/`analysis` renderují `SettingsPage`/`AnalysisPage` s `targetUserId`/`targetProfile`.

**`AnalysisPage.jsx`** — Chart.js. Váha (+ přerušovaná cílová linka z `profile.target_weight`),
kalorie (bary barvené podle historizovaného cíle `getGoalForDate` + dynamická cílová linka).
Mobil detekce `window.innerWidth < 600`.

**`SettingsPage.jsx`** — Edituje `display_name`, `initial_weight`, `target_weight`, `height`,
`age` + 5 cílů (`GOAL_FIELDS`: kcal 2000 / protein 100 / carbs 220 / fat 80 / fiber 30). Snímek
starého profilu → `updateProfile` (self) nebo přímý update + `logGoalChange` (trenér). Přepínač
„Větší písmo" (jen self) → `large_text` do localStorage.

**`FoodsDatabasePage.jsx`** (~855 řádků) — Sdílená DB. Taby dle role: trenér `pending` /
`suggestions (count)` / `all` / `mine`; klient `all` / `mine`. `FoodEditModal` (tvorba/edit/approve —
**záměrně nepropaguje do `diary_entries`**). `PortionSuggestionsPanel` (trenér) — approve/edit/reject návrhů.

---

## Utils (`src/utils/`)

- **`foodSearch.js`** — `round` (1 desetinné), `normalize` (lowercase + bez diakritiky),
  `searchSupabaseFoods(query, limit)` → RPC `search_foods` (min 2 znaky), `supabaseFoodToProduct`
  (mapuje `foods` řádek na OFF-tvar `nutriments['energy-kcal_100g']` …), `recentFoodToProduct`,
  `parseServingSize`, `formatServingLabel`, `portionLabel`.
- **`barcodeLookup.js`** — `lookupByEan(ean)`: GS1 prefix-2 kódy → `in-store` (neunikátní, skip);
  jinak `foods.ean` (lokální); jinak fetch **Open Food Facts** `world.openfoodfacts.org/api/v2/product/{ean}.json`
  (UA header, preferuje `product_name_cs`), detekce tekutin dle názvu/quantity. Vrací `{source, food?|off?}`.
- **`dates.js`** — `toDateStr(d)` / `todayStr()` z **lokálních** částí data (záměrně ne `toISOString()` —
  UTC by v CZ mezi půlnocí a ~1–2 h byl o den pozadu a rozbil zápis váhy i cílů).
- **`week.js`** — `addDays`, `startOfWeek` (od pondělí), `previousWeek`, `weekKey`, `daysInRange`,
  `formatWeekRange` (české genitivní měsíce), `formatShortDate`.

## Lib (`src/lib/`)

- **`supabase.js`** — `createClient(URL, ANON_KEY)`. Anon klíč je **rozdělený do tří stringů**
  (obrana proti truncation build nástroji, ne bezpečnost — JWT je veřejný, bezpečnost drží RLS).
- **`fetchAllRows.js`** — stránkované čtení, obchází 1000-řádkový PostgREST cap. **Používej ho na
  všechna hromadná čtení `diary_entries`.**
- **`goalHistoryWriter.js`** — `logGoalChange(userId, oldProfile, updates)`: upsertuje dnešní řádek
  se všemi 5 cíli, pak per-key gap-aware backfill (minulé dny v mezeře dostanou hodnotu, která
  reálně platila — z `oldProfileSnapshot`, ne novou). Legacy fallback na kcal-only (migrace 023).

## Statická data (`src/data/`)

- **`activities.js`** — `ACTIVITIES_DB`: 32 aktivit `{id, name, kcal_per_hour}` (Chůze 250 … HIIT 700)
  + `searchActivities(query)`. **Živé** — používá `ActivitySection`, `ActivitySearchModal`.
- **`czechFoods.js`** — 607 českých potravin (~691 řádků). **MRTVÝ KÓD** — nikde se neimportuje;
  hledání jde teď celé přes Supabase `foods`. (Kandidát na smazání.)

---

## Mapa volání frontend → backend

**Tabulky (`supabase.from`)**: `profiles`, `diary_days`, `diary_entries`, `meal_notes`,
`trainer_comments`, `activity_entries`, `weight_entries`, `goal_history`, `meal_templates`,
`foods`, `food_portion_suggestions`, `invite_codes`, `announcements`, `announcement_recipients`
(+ **realtime** subscribe na INSERT filtr `user_id`, kanál `announcements_{userId}`).

**RPC (`supabase.rpc`)**: `search_foods({ q, lim })`, `get_recent_foods({ p_meal_id, p_days, p_limit, p_target_user_id })`.

**Edge funkce (`supabase.functions.invoke`)**: `generate-comment`, `generate-all-comments`, `delete-client`.

**Externí HTTP**: Open Food Facts produkt API (přímý fetch, bez klíče).

**Auth (`supabase.auth`)**: getSession, onAuthStateChange (vč. PASSWORD_RECOVERY), signUp
(metadata `display_name`+`invite_code`), signInWithPassword, resetPasswordForEmail, updateUser, signOut, getUser.

> Klíčové pasti (1000-řádkový cap, historizace cílů, derivace jednotek/tekutin, snímky výživy,
> lokální datum) jsou popsané v [08-gotchas-a-pasti.md](08-gotchas-a-pasti.md).
