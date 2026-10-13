// Stáhne VŠECHNY řádky dotazu po stránkách.
//
// PostgREST (Supabase) vrací max ~1000 řádků na jednu odpověď. Hromadné výběry
// bez stránkování se proto tiše ořízly – typicky u klientek/dnů s >1000 položek
// v diary_entries, kde vypadly nejnovější řádky a dny se jevily jako „pod cílem"
// nebo jako bez zápisu. Tenhle helper dotaz zavolá opakovaně přes .range(),
// dokud stránky nedojdou.
//
// `buildQuery` MUSÍ vracet POKAŽDÉ nový query builder (supabase builder nejde
// po awaitnutí použít znovu) a MĚL BY obsahovat stabilní .order() (např. podle
// id), jinak nejsou hranice stránek deterministické.
//
//   const rows = await fetchAllRows(() =>
//     supabase.from('diary_entries').select('day_id, kcal')
//       .in('day_id', dayIds).order('id', { ascending: true }));
export async function fetchAllRows(buildQuery, { pageSize = 1000 } = {}) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

// Totéž, ale seznam hodnot pro `.in()` rozdělí po `chunkSize` kusech a
// výsledky slije. PostgREST posílá filtry v URL – u stovek UUID (typicky
// diary_days za 14 dní × všechny klientky) URL přeroste limit brány
// (414 Request-URI Too Large) a celý dotaz spadne. `buildQuery(idsChunk)`
// dostane vždy jen jednu dávku.
//
//   const rows = await fetchAllRowsIn(dayIds, (ids) =>
//     supabase.from('diary_entries').select('day_id, kcal')
//       .in('day_id', ids).order('id', { ascending: true }));
export async function fetchAllRowsIn(values, buildQuery, { chunkSize = 100, pageSize = 1000 } = {}) {
  if (!values?.length) return [];
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) chunks.push(values.slice(i, i + chunkSize));
  const parts = await Promise.all(
    chunks.map((ids) => fetchAllRows(() => buildQuery(ids), { pageSize })),
  );
  return parts.flat();
}
