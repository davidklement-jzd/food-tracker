# 00 — Přehled: co aplikace je a co umí

## Ve zkratce

**Food Tracker** (produkčně „Jak na zdravé tělo") je webová aplikace pro **online fitness trenéra
Davida Klementa** a jeho **klientky**. Klientky si zapisují jídelníček a pohyb, sledují váhu,
kalorie a makroživiny; trenér jim dává zpětnou vazbu ke každému jídlu — buď ručně, nebo ji nechá
napsat **AI (Claude)** ve svém vlastním stylu.

Aplikace nahrazuje dřívější workflow, kdy trenér komentoval jídelníčky ručně na cizím webu
(kaloricketabulky.cz). Tady má vlastní databázi potravin, vlastní deník, vlastní AI komentování
a přehled nad všemi klientkami.

## Role uživatelů

Role je uložená v `profiles.role` a nabývá dvou hodnot:

### Klientka — `role = 'client'`
- Zapisuje jídla do deníku po jídlech: **snídaně, dopolední svačina, oběd, odpolední svačina,
  večeře** a zvláštní sekce **„Kalorický dluh"** (ruční účetní položka, ne reálné jídlo — interně
  `meal_id = 'supplements'`).
- Hledá potraviny v databázi, **skenuje čárové kódy** (kamera), vytváří vlastní potraviny.
- Ukládá si **oblíbená jídla** („Moje jídla" = šablony více položek pod jedním názvem).
- Sleduje **váhu**, **kalorie**, **makra** (bílkoviny/sacharidy/tuky/vláknina) a **aktivity**.
- Má **cíle** (denní kcal + 4 makra), které jí nastavuje trenér.
- Vidí **komentáře trenéra/AI** ke svým jídlům a **hromadné vzkazy** (announcements) v popupu.
- Gamifikace: **série** (streak) za pravidelné zapisování, medaile s úrovněmi.

### Trenér — `role = 'trainer'`
- **Dashboard** se všemi klientkami (aktivní / archivované), přehledová tabulka za posledních 7 dní
  (kalorie vs. cíl, zapsaná váha, poznámky, neaktivita).
- Čte a edituje **cizí deníky**, píše komentáře ručně nebo **generuje AI komentáře** (po jednom
  jídle i **hromadně** přes více klientek × dní).
- Spravuje **databázi potravin** (schvaluje uživatelské potraviny, edituje, maže, řeší návrhy porcí).
- **Zve klientky** přes jednorázové invite kódy (odkaz `?invite=KÓD`).
- Posílá **hromadné vzkazy** klientkám.
- **Maže klientky** (tvrdé smazání uživatele i dat).
- Má i **vlastní jídelníček** („Můj jídelníček") — trenér může trackovat i sám sebe.

## Hlavní funkční celky

| Celek | Co dělá |
|-------|--------|
| **Deník jídel** | Zápis položek po jídlech; každá položka nese vlastní snímek výživových hodnot (kcal + makra) v gramech nebo ml. |
| **Databáze potravin** | Sdílená tabulka `foods` (seedovaná z USDA / Open Food Facts / kaloricketabulky.cz + ruční). Fuzzy vyhledávání s češtinou napřed. Uživatelské potraviny přes schvalovací flow. |
| **Čtečka čárových kódů** | Kamera → EAN → lokální potravina nebo Open Food Facts. |
| **Váha & cíle** | Denní váha, historie, cílová váha; historizované cíle (aby minulé dny nezměnily hodnocení, když se cíl později změní). |
| **Aktivity** | Zápis pohybu (typ, minuty), přepočet spálených kalorií. |
| **AI komentáře** | Claude píše krátký komentář ke každému jídlu ve stylu trenéra (persona v `styleGuide.ts`). |
| **Trenérský přehled** | Dashboard, přehledová tabulka, hromadné komentování, správa klientek. |
| **Analýza** | Grafy (Chart.js): váha v čase (+ cílová linka), kalorie po dnech (barvené podle denního cíle). |
| **Týdenní přehled** | Automatické shrnutí uzavřeného týdne vs. cíle + změna váhy (popup 1× týdně). |
| **Gamifikace** | Série za pravidelné zapisování (bronz/stříbro/zlato/diamant). |
| **Zvací systém** | Trenér generuje invite kódy; registrace bez platného kódu selže (DB trigger). |
| **Oznámení** | Trenér pošle vzkaz → klientce se zobrazí popup (realtime). |

## Vize a kontext (dlouhodobě)

Cílem je **plnohodnotná náhrada** dřívějšího ručního workflow na kaloricketabulky.cz nativní
appkou s vlastní AI integrací. Trenér tak má vše na jednom místě: data klientek, komentování i
přehled — bez závislosti na cizím webu. (Historicky existuje ještě Claude Code skill
`jidelnicek-feedback`, který komentoval na kaloricketabulky.cz přes prohlížeč — viz
[06-skripty-a-data.md](06-skripty-a-data.md) — ale směr je vlastní appka.)
