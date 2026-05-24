-- Status klientky: 'active' (běžné) nebo 'archived' (bývalá klientka).
-- Archivovaná klientka může appku dál používat, ale v trenérském dashboardu
-- je v záložce "Bývalé" a nelze ji vybrat pro hromadné AI komentování.
-- Trenér UPDATE profilu už má (008_trainer_write.sql).

alter table profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));

create index if not exists idx_profiles_status
  on profiles(status)
  where role = 'client';
