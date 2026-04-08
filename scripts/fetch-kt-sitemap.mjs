#!/usr/bin/env node
// Stáhne všech 8 sub-sitemapů kaloricketabulky.cz a uloží lokální index
// slug → URL do data/kt-slugs.json. Jednorázové.

import { writeFile, mkdir } from 'node:fs/promises';

const SITEMAPS = Array.from({ length: 8 }, (_, i) =>
  `https://www.kaloricketabulky.cz/sitemap/foodstuff/${i}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const slugs = []; // {slug, url}
for (const url of SITEMAPS) {
  console.log(`fetching ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'food-tracker-research/1.0' } });
  if (!res.ok) { console.warn(`  ${res.status}`); continue; }
  const xml = await res.text();
  const matches = xml.matchAll(/<loc>(https:\/\/www\.kaloricketabulky\.cz\/potraviny\/([^<]+))<\/loc>/g);
  for (const m of matches) slugs.push({ url: m[1], slug: m[2] });
  await sleep(1000);
}

await mkdir('data', { recursive: true });
await writeFile('data/kt-slugs.json', JSON.stringify(slugs, null, 0));
console.log(`saved ${slugs.length} slugs to data/kt-slugs.json`);
