-- Remove balance column from ezz_riders table
-- Run this in Supabase SQL Editor after removing balance from application code
ALTER TABLE IF EXISTS ezz_riders DROP COLUMN IF EXISTS balance;
