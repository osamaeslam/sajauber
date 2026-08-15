-- ============================================================
-- Fix RLS policies on ezz_sessions
--
-- المشكلة: There are multiple conflicting/overlapping RLS policies
-- on ezz_sessions from previous migrations (Deny anon read sessions,
-- anon can insert/update/delete sessions, device_read_own_sessions,
-- anon_write_sessions, etc.). This causes SQL errors when the
-- SQL_SCHEMA in supabaseService.ts tries to recreate policies
-- that already exist.
--
-- الحل: Drop all existing policies on ezz_sessions and recreate
-- clean, non-conflicting policies.
-- ============================================================

-- Drop ALL existing policies on ezz_sessions
DROP POLICY IF EXISTS "Deny anon read sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public read sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public write sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public update sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public delete sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "anon can insert sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "anon can update sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "anon can delete sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "device_read_own_sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "anon_write_sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "anon_read_sessions" ON ezz_sessions;

-- Recreate clean policies
CREATE POLICY "anon_read_sessions" ON ezz_sessions
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_write_sessions" ON ezz_sessions
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
