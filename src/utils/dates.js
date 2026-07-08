// Lokální datum jako YYYY-MM-DD. Deník naviguje podle lokálního data, takže
// „dnešek" musí být počítán taky lokálně — new Date().toISOString() vrací UTC
// a v ČR (UTC+1/+2) je mezi půlnocí a ~01:00/02:00 o den pozadu (klientka pak
// nemůže zapsat dnešní váhu, cíle se logují pod včerejšek).

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr() {
  return toDateStr(new Date());
}
