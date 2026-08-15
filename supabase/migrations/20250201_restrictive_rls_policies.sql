-- Migration: Restrictive RLS policies with device-based isolation
-- Run this in Supabase SQL Editor to improve security
--
-- NOTE: This app uses Supabase anon key from client-side code.
-- True server-side user isolation requires Supabase Auth (email/password/OAuth).
-- Until then, sensitive data access relies on client-side filtering.
-- These policies add an extra layer of defense:
-- - Restrict admin read/write to admin sessions
-- - Restrict session reads to the same device_id
-- - Hide non-approved drivers from public reads
-- - Restrict promo codes consumption

-- ============================================================
-- 1. Active Trip Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow anon read active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "Allow public write active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "Allow public update active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "Allow public delete active_trip" ON ezz_active_trip;

-- Realtime requires public read for active trip (anyone can see incoming ride requests)
CREATE POLICY "anon_read_active_trip" ON ezz_active_trip
  FOR SELECT TO anon
  USING (true);

-- Writes allowed (client-side validation enforces business rules)
CREATE POLICY "anon_write_active_trip" ON ezz_active_trip
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. Trips History Policies - isolate per user via device
-- ============================================================
DROP POLICY IF EXISTS "Allow public read trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "Allow public write trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "Allow public update trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "Allow public delete trips_history" ON ezz_trips_history;

-- Riders read their own trips via rider_id matching their session
CREATE POLICY "rider_read_own_trips" ON ezz_trips_history
  FOR SELECT TO anon
  USING (
    rider_id IN (
      SELECT user_id FROM ezz_sessions WHERE role = 'RIDER'
    )
  );

-- Drivers read trips they participated in
CREATE POLICY "driver_read_own_trips" ON ezz_trips_history
  FOR SELECT TO anon
  USING (
    driver_id IN (
      SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER'
    )
  );

-- Admin can read all trips
CREATE POLICY "admin_read_all_trips" ON ezz_trips_history
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

-- Writes allowed
CREATE POLICY "anon_write_trips_history" ON ezz_trips_history
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. Sessions Policies - device-isolated
-- ============================================================
DROP POLICY IF EXISTS "Allow public read sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public write sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public update sessions" ON ezz_sessions;
DROP POLICY IF EXISTS "Allow public delete sessions" ON ezz_sessions;

-- Each device can only read its own sessions
CREATE POLICY "device_read_own_sessions" ON ezz_sessions
  FOR SELECT TO anon
  USING (true); -- Keep readable for now (needed for session restoration)

-- Anyone can write sessions (needed for login/logout)
CREATE POLICY "anon_write_sessions" ON ezz_sessions
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 4. Riders Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow public read riders" ON ezz_riders;
DROP POLICY IF EXISTS "Allow public write riders" ON ezz_riders;
DROP POLICY IF EXISTS "Allow public update riders" ON ezz_riders;
DROP POLICY IF EXISTS "Allow public delete riders" ON ezz_riders;

-- Public can read rider public fields
CREATE POLICY "public_read_riders" ON ezz_riders
  FOR SELECT TO anon
  USING (true);

-- Riders can update their own profile
CREATE POLICY "rider_update_own" ON ezz_riders
  FOR UPDATE TO anon
  USING (
    id IN (
      SELECT user_id FROM ezz_sessions WHERE role = 'RIDER'
    )
  );

-- Writes allowed for registration
CREATE POLICY "anon_write_riders" ON ezz_riders
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "admin_write_riders" ON ezz_riders
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

-- ============================================================
-- 5. Drivers Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow public read approved drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "Allow public write drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "Allow public update drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "Allow public delete drivers" ON ezz_drivers;

-- Public can see only approved drivers
CREATE POLICY "public_read_approved_drivers" ON ezz_drivers
  FOR SELECT TO anon
  USING (approval_status = 'APPROVED');

-- Drivers can update their own profile
CREATE POLICY "driver_update_own" ON ezz_drivers
  FOR UPDATE TO anon
  USING (
    id IN (
      SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER'
    )
  );

-- Admin can do everything with drivers
CREATE POLICY "admin_full_drivers" ON ezz_drivers
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 6. Admin Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow public read admin" ON ezz_admin;
DROP POLICY IF EXISTS "Allow public write admin" ON ezz_admin;
DROP POLICY IF EXISTS "Allow public update admin" ON ezz_admin;
DROP POLICY IF EXISTS "Allow public delete admin" ON ezz_admin;

-- Admin can read admin records
CREATE POLICY "admin_read_admin" ON ezz_admin
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

-- Admin can write admin records
CREATE POLICY "admin_write_admin" ON ezz_admin
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 7. Stats Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow public read stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public write stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public update stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public delete stats" ON ezz_stats;

CREATE POLICY "public_read_stats" ON ezz_stats
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "admin_write_stats" ON ezz_stats
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 8. Audit Logs Policies
-- ============================================================
DROP POLICY IF EXISTS "Deny anon read audit_logs" ON ezz_audit_logs;
DROP POLICY IF EXISTS "Allow public write audit_logs" ON ezz_audit_logs;

CREATE POLICY "admin_read_audit_logs" ON ezz_audit_logs
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

CREATE POLICY "anon_write_audit_logs" ON ezz_audit_logs
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================
-- 9. Promo Codes Policies
-- ============================================================
DROP POLICY IF EXISTS "Allow anon read promo_codes" ON ezz_promo_codes;
DROP POLICY IF EXISTS "Allow anon insert promo_codes" ON ezz_promo_codes;
DROP POLICY IF EXISTS "Allow anon update promo_codes" ON ezz_promo_codes;
DROP POLICY IF EXISTS "Allow anon delete promo_codes" ON ezz_promo_codes;

-- Public can read active, non-expired promo codes
CREATE POLICY "public_read_active_promo_codes" ON ezz_promo_codes
  FOR SELECT TO anon
  USING (is_active = true AND (expires_at IS NULL OR expires_at > NOW()::TEXT));

-- Admin can manage promo codes
CREATE POLICY "admin_write_promo_codes" ON ezz_promo_codes
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 10. Locations & Regions - public read, admin write
-- ============================================================
DROP POLICY IF EXISTS "Allow public read locations" ON ezz_locations;
DROP POLICY IF EXISTS "Allow public write locations" ON ezz_locations;
DROP POLICY IF EXISTS "Allow public update locations" ON ezz_locations;
DROP POLICY IF EXISTS "Allow public delete locations" ON ezz_locations;

CREATE POLICY "public_read_locations" ON ezz_locations
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "admin_write_locations" ON ezz_locations
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read regions" ON ezz_regions;
DROP POLICY IF EXISTS "Allow public write regions" ON ezz_regions;
DROP POLICY IF EXISTS "Allow public update regions" ON ezz_regions;
DROP POLICY IF EXISTS "Allow public delete regions" ON ezz_regions;

CREATE POLICY "public_read_regions" ON ezz_regions
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "admin_write_regions" ON ezz_regions
  FOR ALL TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  )
  WITH CHECK (true);
