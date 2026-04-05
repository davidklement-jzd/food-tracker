-- Helper function to check trainer role (bypasses RLS, avoids infinite recursion)
create or replace function public.is_trainer()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'trainer'
  );
$$ language sql security definer stable;

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table diary_days enable row level security;
alter table diary_entries enable row level security;
alter table meal_notes enable row level security;
alter table trainer_comments enable row level security;
alter table ai_comment_log enable row level security;

-- ===== PROFILES =====
create policy "Users read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Trainer reads all profiles"
  on profiles for select using (public.is_trainer());

-- ===== DIARY_DAYS =====
create policy "Client manages own diary_days"
  on diary_days for all using (user_id = auth.uid());

create policy "Trainer reads all diary_days"
  on diary_days for select using (public.is_trainer());

-- ===== DIARY_ENTRIES =====
create policy "Client manages own entries"
  on diary_entries for all
  using (exists (select 1 from diary_days where id = diary_entries.day_id and user_id = auth.uid()));

create policy "Trainer reads all entries"
  on diary_entries for select using (public.is_trainer());

-- ===== MEAL_NOTES =====
create policy "Client manages own notes"
  on meal_notes for all
  using (exists (select 1 from diary_days where id = meal_notes.day_id and user_id = auth.uid()));

create policy "Trainer reads all notes"
  on meal_notes for select using (public.is_trainer());

-- ===== TRAINER_COMMENTS =====
create policy "Trainer manages comments"
  on trainer_comments for all using (public.is_trainer());

create policy "Client reads own comments"
  on trainer_comments for select
  using (exists (select 1 from diary_days where id = trainer_comments.day_id and user_id = auth.uid()));

-- ===== AI_COMMENT_LOG =====
create policy "Trainer reads ai logs"
  on ai_comment_log for select using (public.is_trainer());

-- Edge functions use service role key, so they bypass RLS for inserts
