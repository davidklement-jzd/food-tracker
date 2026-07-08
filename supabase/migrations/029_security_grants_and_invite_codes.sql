-- BEZPEČNOST + PROVOZ: dvě věci v jedné migraci.
--
-- 1) Explicitní GRANTy na tabulky z migrací 001–022.
--    Od 30. 10. 2026 Supabase vyžaduje explicitní `grant ... to authenticated`
--    u tabulek v public schema; starší tabulky spoléhaly na implicitní default
--    granty. Migrace 026 už vzor zavedla, tady ho doplňujeme na zbytek. RLS
--    politiky zůstávají skutečným filtrem řádků — grant jen zpřístupní tabulku
--    roli `authenticated`, aby politiky měly efekt i po případném odvolání
--    legacy grantů / při čerstvém nasazení.
--
-- 2) invite_codes: politiky kontrolovaly jen `trainer_id = auth.uid()`, ne
--    `is_trainer()`. Klientka si mohla vložit řádek s trainer_id = vlastní id
--    a razit platné pozvánkové kódy (obejití uzavřené registrace). Přidáváme
--    podmínku `is_trainer()`.

-- ===== 1) GRANTy na starší tabulky =====
grant select, insert, update, delete on public.profiles              to authenticated;
grant select, insert, update, delete on public.diary_days            to authenticated;
grant select, insert, update, delete on public.diary_entries         to authenticated;
grant select, insert, update, delete on public.meal_notes            to authenticated;
grant select, insert, update, delete on public.trainer_comments      to authenticated;
grant select, insert, update, delete on public.ai_comment_log        to authenticated;
grant select, insert, update, delete on public.weight_entries        to authenticated;
grant select, insert, update, delete on public.goal_history          to authenticated;
grant select, insert, update, delete on public.activity_entries      to authenticated;
grant select, insert, update, delete on public.foods                 to authenticated;
grant select, insert, update, delete on public.invite_codes          to authenticated;
grant select, insert, update, delete on public.meal_templates        to authenticated;
grant select, insert, update, delete on public.food_portion_suggestions to authenticated;

-- ===== 2) invite_codes: vyžadovat roli trenéra =====
drop policy if exists "trainer_select_own_invites"   on public.invite_codes;
drop policy if exists "trainer_insert_invites"        on public.invite_codes;
drop policy if exists "trainer_delete_unused_invites" on public.invite_codes;

create policy "trainer_select_own_invites"
  on public.invite_codes for select
  using (public.is_trainer() and trainer_id = auth.uid());

create policy "trainer_insert_invites"
  on public.invite_codes for insert
  with check (public.is_trainer() and trainer_id = auth.uid());

create policy "trainer_delete_unused_invites"
  on public.invite_codes for delete
  using (public.is_trainer() and trainer_id = auth.uid() and used_by is null);
