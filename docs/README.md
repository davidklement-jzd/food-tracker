# Food Tracker — dokumentace pro obnovu / rebuild

> **Účel tohoto balíku:** Kompletní technický popis aplikace „Jak na zdravé tělo" (Food Tracker)
> tak, aby ji šlo z tohoto textu **postavit znovu od nuly** — ať už to zadáš jiné AI, budoucí verzi
> Claude, nebo lidskému vývojáři. Popisuje, co appka je, co umí, jak je poskládaná, kde co leží
> a jak ji nasadit.

**Snapshot k datu:** 2026-08-02 · stav gitu: větev `main`, poslední commit `74da73d`.
Pokud čteš tenhle text mnohem později, ber čísla (30 migrací, model ID, verze balíčků) jako stav
k tomuto datu a ověř je proti aktuálnímu kódu.

---

## Jak balík použít

Když budeš appku obnovovat, čti soubory v tomto pořadí:

| # | Soubor | O čem to je |
|---|--------|------------|
| 00 | [00-prehled.md](00-prehled.md) | Co aplikace je, komu slouží, jaké má role a funkce (netechnicky) |
| 01 | [01-architektura.md](01-architektura.md) | Tech stack, jak spolu vrstvy komunikují, diagram |
| 02 | [02-datovy-model.md](02-datovy-model.md) | Kompletní databáze: tabulky, sloupce, RLS, RPC, triggery, granty |
| 03 | [03-frontend.md](03-frontend.md) | React aplikace: navigace, hooky, komponenty, utils, mapa volání |
| 04 | [04-edge-funkce-a-ai.md](04-edge-funkce-a-ai.md) | Supabase edge funkce, napojení na Claude API, secrets |
| 05 | [05-deploy-a-prostredi.md](05-deploy-a-prostredi.md) | Build, Vercel, Supabase CLI, env proměnné, kde co leží |
| 06 | [06-skripty-a-data.md](06-skripty-a-data.md) | Offline Node skripty (seed/import/překlad) a seed data |
| 07 | [07-rebuild-od-nuly.md](07-rebuild-od-nuly.md) | **Krok za krokem: jak to postavit znovu** |
| 08 | [08-gotchas-a-pasti.md](08-gotchas-a-pasti.md) | Zrádná místa a business logika, kterou nesmíš rozbít |

**Když chceš jen appku rychle znovu rozjet:** začni u [07-rebuild-od-nuly.md](07-rebuild-od-nuly.md)
a odkazuj se zpátky do 02–05 pro detaily.

---

## Co je potřeba mít po ruce (a NENÍ v tomto repu)

Tenhle balík popisuje **kód a strukturu**. Aby appka reálně běžela, potřebuješ ještě tajné klíče a
účty, které v gitu **záměrně nejsou** (a nikdy být nemají). Kde je vzít:

- **Supabase projekt** — účet na [supabase.com](https://supabase.com). Původní projekt má ref
  `uxffnpajkhcvtwzsmrcl`. Z něj potřebuješ `SUPABASE_URL`, `anon key`, `service_role key`.
- **Anthropic API klíč** (`ANTHROPIC_API_KEY`) — účet na [console.anthropic.com](https://console.anthropic.com), pro AI komentáře.
- **Resend API klíč** (`RESEND_API_KEY`) — [resend.com](https://resend.com), pro e-mail „nová klientka".
- **USDA API klíč** (`USDA_API_KEY`) — jen pokud budeš znovu seedovat databázi potravin z USDA.
- **Vercel účet** — pro hosting frontendu.

Přesný seznam, kam který klíč patří, je v [05-deploy-a-prostredi.md](05-deploy-a-prostredi.md).

---

## Poznámka pro budoucí AI, která tohle čte

- Aplikace je psaná **v češtině** (UI, komentáře, systémový prompt). Zachovej to.
- Backend autorizace **stojí a padá na Row-Level Security (RLS)** v Postgresu, ne na frontend
  kontrolách. Nikdy nepřesouvej autorizaci do UI.
- Tón textů pro klientky: **vykání** u vzkazů od trenéra (připomínka váhy, týdenní přehled),
  **tykání** OK u gamifikace (medaile za sérii). Shrnutí věcná, ne emotivní.
- Detailní pasti a „nerozbij tohle" jsou v [08-gotchas-a-pasti.md](08-gotchas-a-pasti.md) — přečti si je dřív, než začneš měnit datové toky.
