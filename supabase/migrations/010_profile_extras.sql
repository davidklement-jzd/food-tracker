-- Add target weight, height, age to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_weight real;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS height real;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS age integer;
