-- 032_client_ai_notes.sql
-- Trvalá poznámka trenéra ke klientce, kterou čte jen trenér a AI komentování
-- („u této klientky neřešit to a to").
--
-- ZÁMĚRNĚ samostatná tabulka, ne sloupec v profiles: klientka si svůj profil
-- čte přes select('*') a RLS filtruje řádky, ne sloupce, takže by poznámku
-- dostala v odpovědi. Sem klientka nemá žádnou politiku, tedy ani čtení.
--
-- Edge funkce čtou poznámku přes service role (obchází RLS, ne ale GRANT).

create table if not exists public.client_ai_notes (
  client_id uuid primary key references public.profiles(id) on delete cascade,
  note_text text not null check (char_length(note_text) between 1 and 2000),
  updated_at timestamptz not null default now()
);

alter table public.client_ai_notes enable row level security;

-- Jediná politika: trenér. Klientka a nepřihlášený nedostanou žádný řádek.
create policy "Trainer manages client AI notes"
  on public.client_ai_notes for all
  using (public.is_trainer())
  with check (public.is_trainer());

-- Explicitní granty (od 30.10.2026 povinné u každé nové tabulky v public).
-- RLS drží řádky; anon nemá k tabulce důvod mít přístup vůbec.
revoke all on public.client_ai_notes from anon;
grant select, insert, update, delete on public.client_ai_notes to authenticated;
grant select on public.client_ai_notes to service_role;
