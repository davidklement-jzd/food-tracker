-- 026_announcements.sql
-- Trenér posílá zprávy (oznámení) vybraným klientkám. Klientka je uvidí jako
-- vyskakovací okno při otevření aplikace a odklikne je (dismissed_at).

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- Příjemci se "zhmotní" při odeslání (snapshot vybraných klientek).
-- dismissed_at = null znamená, že klientka zprávu ještě nezavřela.
create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz,
  primary key (announcement_id, user_id)
);

-- Rychlé dotažení nepřečtených zpráv klientky.
create index if not exists announcement_recipients_unread_idx
  on public.announcement_recipients (user_id)
  where dismissed_at is null;

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;

-- Trenér spravuje vše.
create policy "Trainer manages announcements"
  on public.announcements for all using (public.is_trainer());

create policy "Trainer manages recipients"
  on public.announcement_recipients for all using (public.is_trainer());

-- Klientka čte zprávy, které jí byly určené.
create policy "Client reads own announcements"
  on public.announcements for select
  using (exists (
    select 1 from public.announcement_recipients r
    where r.announcement_id = announcements.id and r.user_id = auth.uid()
  ));

-- Klientka čte své příjemcové řádky a smí si je označit jako přečtené.
create policy "Client reads own recipient rows"
  on public.announcement_recipients for select
  using (user_id = auth.uid());

create policy "Client dismisses own recipient rows"
  on public.announcement_recipients for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Explicitní granty (od 30.10.2026 povinné u každé nové tabulky v public).
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.announcement_recipients to authenticated;
