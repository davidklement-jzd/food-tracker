-- Goal history table
CREATE TABLE IF NOT EXISTS goal_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  goal_kcal int NOT NULL,
  date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_goal_history_user_date ON goal_history(user_id, date);

-- RLS
ALTER TABLE goal_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own goal history"
  ON goal_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goal history"
  ON goal_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goal history"
  ON goal_history FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Trainers can read all goal history"
  ON goal_history FOR SELECT
  USING (is_trainer());
