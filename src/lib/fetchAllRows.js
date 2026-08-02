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
