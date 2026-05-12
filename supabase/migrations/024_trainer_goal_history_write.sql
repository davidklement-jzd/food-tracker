-- Trainers can insert/update goal_history for any user.
-- 005_goal_history.sql přidala policies jen pro vlastníka. 008_trainer_write.sql
-- udělala totéž pro všechny ostatní tabulky kromě goal_history — proto
-- logGoalChange volaný trenérem nad klientčiným profilem tiše selhával na RLS,
-- profil se updatnul, ale historizace ne. Důsledek: minulé dny ukazovaly starou
-- hodnotu z (chybějícího/starého) history řádku, dnešek z profilu (= nová).
CREATE POLICY "Trainers can insert goal_history"
  ON goal_history FOR INSERT
  WITH CHECK (is_trainer());

CREATE POLICY "Trainers can update goal_history"
  ON goal_history FOR UPDATE
  USING (is_trainer());
