-- Trainers can insert diary_days for any user
CREATE POLICY "Trainers can insert diary_days"
  ON diary_days FOR INSERT
  WITH CHECK (is_trainer());

-- Trainers can insert/update/delete diary_entries
CREATE POLICY "Trainers can insert diary_entries"
  ON diary_entries FOR INSERT
  WITH CHECK (is_trainer());

CREATE POLICY "Trainers can update diary_entries"
  ON diary_entries FOR UPDATE
  USING (is_trainer());

CREATE POLICY "Trainers can delete diary_entries"
  ON diary_entries FOR DELETE
  USING (is_trainer());

-- Trainers can insert/update/delete meal_notes
CREATE POLICY "Trainers can insert meal_notes"
  ON meal_notes FOR INSERT
  WITH CHECK (is_trainer());

CREATE POLICY "Trainers can update meal_notes"
  ON meal_notes FOR UPDATE
  USING (is_trainer());

CREATE POLICY "Trainers can delete meal_notes"
  ON meal_notes FOR DELETE
  USING (is_trainer());

-- Trainers can insert/update weight_entries
CREATE POLICY "Trainers can insert weight_entries"
  ON weight_entries FOR INSERT
  WITH CHECK (is_trainer());

CREATE POLICY "Trainers can update weight_entries"
  ON weight_entries FOR UPDATE
  USING (is_trainer());

-- Trainers can insert/delete activity_entries
CREATE POLICY "Trainers can insert activity_entries"
  ON activity_entries FOR INSERT
  WITH CHECK (is_trainer());

CREATE POLICY "Trainers can delete activity_entries"
  ON activity_entries FOR DELETE
  USING (is_trainer());

CREATE POLICY "Trainers can update activity_entries"
  ON activity_entries FOR UPDATE
  USING (is_trainer());

-- Trainers can update any profile (for goals)
CREATE POLICY "Trainers can update profiles"
  ON profiles FOR UPDATE
  USING (is_trainer());
