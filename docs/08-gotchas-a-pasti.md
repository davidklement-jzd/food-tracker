# 08 — Gotchas a pasti (nerozbij tohle)

Business logika a zrádná místa, která nejsou zřejmá z kódu na první pohled. Když appku měníš nebo
přepisuješ, tohle musí přežít.

---

## Data / backend

### 1. 1000-řádkový PostgREST cap
Hromadné `.select()` / `.in()` bez stránkování se **tiše ořízne na 1000 řádků** — appka pak vypadá,
že aktivní klientka je „pod cílem" nebo neaktivní. Všechna hromadná čtení `diary_entries` musí jít
přes `src/lib/fetchAllRows.js` se stabilním `.order('id')`. Týká se `useCalorieHistory` a
`TrainerDashboard.buildBulkSummary` (kcal součty i sken neaktivity).

### 2. Historizace cílů (`goal_history`)
`goalHistoryWriter.logGoalChange` upsertuje dnešní řádek se všemi 5 cíli a pak per-key gap-aware
backfill: minulé dny v mezeře dostanou hodnotu, která **reálně platila** (`oldProfileSnapshot`),
ne novou. `useGoalHistory.getGoalForDate`: dnes/budoucnost = aktuální profil; minulý den = poslední
řádek ≤ datum; když žádný, tak **nejstarší** zaznamenaná hodnota — **nikdy aktuální profil**. Tím
zůstane hodnocení minulých dnů stabilní, i když se cíl později změní. Legacy fallback na kcal-only,
když makro sloupce neexistují (migrace 023).

### 3. Snímky výživy v `diary_entries`
Každá položka deníku nese vlastní kcal/makra. Editace potraviny v `foods` se **záměrně nepropaguje**
do existujících `diary_entries` (`FoodEditModal` to nedělá). Historie zůstává tak, jak byla zapsaná.

### 4. Derivace jednotek a tekutin
`buildDiaryEntry` / `isLikelyLiquid`: `unit='ml'`, když `foods.is_liquid` nebo název/brand sedí na
liquid regex. Porce se derivují z `foods.portions` → syntetická „Porce" z `default_grams` → default
tekuté porce (250/330/500/1000 ml). Zastaralé `"Ng"` display_amount se pro tekutiny přegeneruje na
`"Nml"`. `DailySummary` sčítá „Tekutiny" jen z položek s `unit==='ml'`.

### 5. Uložená jídla = sdílený `group_id`
Šablona vložená do deníku = víc `diary_entries` se stejným `group_id` + `group_name`.
`MealSection` je renderuje jako jednu sbalitelnou položku se sečtenými makry. Kopírování dne
(`CopyMealModal`) **regeneruje nové `group_id`**.

### 6. Váha se nedá zpětně datovat
`useWeightTracker.saveWeight` vždy upsertuje pod **dnešní** datum (`todayStr()`), i když prohlížíš
minulý den. `weightForDate` = poslední záznam na/před vybraným datem.

### 7. Streak „žije" přes dnešek
`useStreak`: série je platná, když poslední zapsaný den je dnes nebo včera. `diary_entries!inner(id)`
filtruje prázdné dny. Přepočet přes signal (bez reloadu).

### 8. Připomínka váhy jen pro „starousedlíky"
`useWeightReminder.overdue` je true jen když váha **existuje** a je ≥7 dní stará. Nové klientky bez
jediné váhy se **nešťouchají**.

### 9. Invite kód je povinný a jednorázový
Trigger `handle_new_user` (migrace 019) při registraci vyžaduje platný, nepoužitý, neexpirovaný
`invite_code` z metadat. Bez něj registrace **selže na DB úrovni** (Supabase vrátí generickou
„Database error saving new user", `AuthPage` ji mapuje na hlášku o kódu). Kódy expirují za 7 dní.

### 10. Trenérské zápisy přes service role obchází RLS
AI komentáře a mazání klientky píše **service role** v edge funkcích — RLS politiky na
`trainer_comments`/`ai_comment_log` řídí jen **čtení**. Autorizaci (že volající je trenér) dělá
`requireTrainer` v kódu, ne gateway (`verify_jwt=false`).

### 11. Granty jsou povinné (od 30.10.2026)
Nová tabulka v `public` **musí** dostat `grant … to authenticated`, jinak je pro appku neviditelná
i při správném RLS. Viz migrace 026/029.

---

## Frontend

### 12. Lokální datum, nikdy `toISOString()`
`utils/dates.js` skládá „dnešní" datum z **lokálních** částí. `toISOString()` je UTC → v CZ mezi
půlnocí a ~1–2 h ráno o den pozadu → rozbil by zápis váhy i historizaci cílů. Nepoužívej UTC.

### 13. Anon key rozdělený do tří stringů
`src/lib/supabase.js` skládá anon JWT ze tří fragmentů — obrana proti truncation build nástrojem,
**ne** bezpečnostní opatření (JWT je veřejný). Při migraci projektu ho uprav.

### 14. Duplikovaná konstanta `MEALS` a date helpery
`MEALS` je zkopírované ve `App.jsx`, `TrainerClientDiary.jsx` a (bez supplements) `CopyMealModal.jsx`;
date helpery taky duplikované místo importu z `utils/dates`. Když měníš pořadí/labely jídel, hlídej
všechna místa.

### 15. `czechFoods.js` je mrtvý kód
607 potravin v `src/data/czechFoods.js` se nikde neimportuje — hledání jde celé přes Supabase `foods`.
Kandidát na smazání; nepleť se tím při orientaci.

### 16. `supplements` = „Kalorický dluh", ne jídlo
`meal_id='supplements'` je ruční účetní sekce. **AI komentáře ji přeskakují**
(`COMMENTABLE_MEAL_IDS` ji nezahrnuje), „Okomentovat celý den" taky.

---

## AI / edge funkce

### 17. Model se čte z env, ne hardcoded
`_shared/http.ts`: `AI_MODEL = env ?? "claude-sonnet-4-6"`. (Paměťová poznámka „natvrdo na 4 místech"
je zastaralá.) Vyřazený model → 404 = permanent (neopakuje se) → tiché „0 komentářů". Fix: změň
secret `AI_MODEL` na aktuální ID.

### 18. Rate limit fail-open, denní strop v UTC
`enforceAiDailyLimit` počítá dnešní řádky `ai_comment_log` (UTC půlnoc) vs. `AI_DAILY_LIMIT` (300).
Při chybě dotazu **radši pustí** (fail-open). Hromadné komentování kontroluje limit i uvnitř smyčky.

### 19. Výstup AI tvrdě ořezán na 250 znaků
`trimToLastSentence` + strop 250 znaků. `trainer_comments.comment_text` i ruční komentáře drží ≤250.

### 20. Persona = vykání + mužský rod
`styleGuide.ts` vynucuje vykání a mužský rod 1. osoby (trenér je muž), „přepis" max 1× denně,
zakázaná slova. Když měníš prompt, tyhle invarianty zachovej — jinak komentáře znějí špatně.

---

## Tón textů (napříč appkou)
- **Vykání** — vzkazy od trenéra: připomínka váhy, týdenní přehled, AI komentáře.
- **Tykání OK** — gamifikace (medaile za sérii).
- Shrnutí **věcná, ne emotivní**.
