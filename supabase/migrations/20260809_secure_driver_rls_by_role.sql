-- Secure driver RLS policies using app.current_role
-- This avoids slow subqueries and prevents timeout errors.

-- Helper function to set role per-request
CREATE OR REPLACE FUNCTION set_app_role(role TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_role', role, false);
END;
$$;

-- Drop old conflicting policies
DROP POLICY IF EXISTS "anon can update drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "anon can insert drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "anon can delete drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "driver_update_own" ON ezz_drivers;
DROP POLICY IF EXISTS "admin_full_drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "admin_read_admin" ON ezz_admin;
DROP POLICY IF EXISTS "ezz_admin_rw_by_role" ON ezz_admin;

-- Drivers: allow read/write when app.current_role is set to DRIVER or ADMIN
CREATE POLICY "ezz_drivers_rw_by_role" ON ezz_drivers
  FOR ALL TO anon
  USING (current_setting('app.current_role', true) IN ('DRIVER', 'ADMIN'))
  WITH CHECK (current_setting('app.current_role', true) IN ('DRIVER', 'ADMIN'));

-- Drivers: public can read approved drivers only
CREATE POLICY "public_read_approved_drivers" ON ezz_drivers
  FOR SELECT TO anon
  USING (approval_status = 'APPROVED');

-- Admin table: readable/writable when ADMIN role is active
CREATE POLICY "ezz_admin_rw_by_role" ON ezz_admin
  FOR ALL TO anon
  USING (current_setting('app.current_role', true) = 'ADMIN')
  WITH CHECK (current_setting('app.current_role', true) = 'ADMIN');

-- Index to speed up the existing loadSession query
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_device
ON ezz_sessions (role, device_id);

-- Index to speed up driver lookups
CREATE INDEX IF NOT EXISTS idx_ezz_drivers_id
ON ezz_drivers (id);
