-- Add initial_weight to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS initial_weight real;

-- Weight entries table
CREATE TABLE IF NOT EXISTS weight_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  weight real NOT NULL,
  date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_weight_entries_user_date ON weight_entries(user_id, date);

-- RLS
ALTER TABLE weight_entries ENABLE ROW LEVEL SECURITY;

-- Clients: read/write own weight entries
CREATE POLICY "Users can read own weight entries"
  ON weight_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weight entries"
  ON weight_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weight entries"
  ON weight_entries FOR UPDATE
  USING (auth.uid() = user_id);

-- Trainers: read all weight entries
CREATE POLICY "Trainers can read all weight entries"
  ON weight_entries FOR SELECT
  USING (is_trainer());
