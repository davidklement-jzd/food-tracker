-- Activity entries table (shares diary_days with food entries)
CREATE TABLE IF NOT EXISTS activity_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  day_id uuid NOT NULL REFERENCES diary_days(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration int NOT NULL,
  kcal_burned real NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_entries_day ON activity_entries(day_id);

-- RLS
ALTER TABLE activity_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activity entries"
  ON activity_entries FOR SELECT
  USING (day_id IN (SELECT id FROM diary_days WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own activity entries"
  ON activity_entries FOR INSERT
  WITH CHECK (day_id IN (SELECT id FROM diary_days WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own activity entries"
  ON activity_entries FOR DELETE
  USING (day_id IN (SELECT id FROM diary_days WHERE user_id = auth.uid()));

CREATE POLICY "Trainers can read all activity entries"
  ON activity_entries FOR SELECT
  USING (is_trainer());
