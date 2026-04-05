-- profiles: user metadata + role + personal goals
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'client' check (role in ('client', 'trainer')),
  goal_kcal int not null default 2000,
  goal_protein int not null default 100,
  goal_carbs int not null default 220,
  goal_fat int not null default 80,
  goal_fiber int not null default 30,
  created_at timestamptz not null default now()
);

-- diary_days: one row per user per date
create table diary_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique(user_id, date)
);

-- diary_entries: food items per meal
create table diary_entries (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references diary_days(id) on delete cascade,
  meal_id text not null check (meal_id in ('breakfast','snack1','lunch','snack2','dinner','supplements')),
  name text not null,
  brand text not null default '',
  grams int not null,
  display_amount text,
  kcal real not null,
  protein real not null,
  carbs real not null,
  fat real not null,
  fiber real not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- meal_notes: client's personal notes per meal
create table meal_notes (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references diary_days(id) on delete cascade,
  meal_id text not null,
  note_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(day_id, meal_id)
);

-- trainer_comments: trainer or AI comments per meal
create table trainer_comments (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references diary_days(id) on delete cascade,
  meal_id text not null,
  comment_text text not null,
  author text not null default 'trainer' check (author in ('trainer', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(day_id, meal_id)
);

-- ai_comment_log: track API usage and costs
create table ai_comment_log (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references diary_days(id) on delete cascade,
  meal_id text not null,
  prompt_tokens int,
  completion_tokens int,
  model text,
  raw_response text,
  created_at timestamptz not null default now()
);

-- indexes for common queries
create index idx_diary_days_user_date on diary_days(user_id, date);
create index idx_diary_entries_day on diary_entries(day_id);
create index idx_trainer_comments_day on trainer_comments(day_id);
