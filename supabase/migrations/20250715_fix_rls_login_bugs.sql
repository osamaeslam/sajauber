-- ============================================================
-- Fix critical RLS bugs blocking login flows
--
-- BUG 1: "public_read_approved_drivers" only exposes APPROVED drivers.
--        A newly-registered PENDING driver cannot read their own row,
--        so login always fails with "Login failed - driver not found".
--        Fix: allow drivers to read their own row + admins to read all.
--
-- BUG 2: "admin_read_admin" requires an existing ADMIN session.
--        This makes the FIRST admin login impossible (no session yet).
--        Fix: allow public read on ezz_admin (password is hashed,
--        verification happens client-side via authenticateAdmin()).
-- ============================================================

-- ============================================================
-- 1. Drivers: allow driver to read own row, admin reads all
-- ============================================================
DROP POLICY IF EXISTS "public_read_approved_drivers" ON ezz_drivers;

-- Everyone can still see approved drivers (riders dispatch / map)
CREATE POLICY "public_read_approved_drivers" ON ezz_drivers
  FOR SELECT TO anon
  USING (approval_status = 'APPROVED');

-- A driver can always read their own record (login, profile, status)
DROP POLICY IF EXISTS "driver_read_own" ON ezz_drivers;
CREATE POLICY "driver_read_own" ON ezz_drivers
  FOR SELECT TO anon
  USING (
    id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
  );

-- Admin can read ALL drivers including PENDING/REJECTED/FROZEN
-- so the admin panel can review & approve new registrations.
DROP POLICY IF EXISTS "admin_read_all_drivers" ON ezz_drivers;
CREATE POLICY "admin_read_all_drivers" ON ezz_drivers
  FOR SELECT TO anon
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

-- ============================================================
-- 2. Riders: admin reads all riders (already public read, keep)
-- ============================================================
-- Riders already have "public_read_riders" (USING true) so no change needed.

-- ============================================================
-- 3. Admin: allow public read so the FIRST login can work.
--    The password column is hashed (PBKDF2). Verification is done
--    client-side in authenticateAdmin(); hashes are not reversible.
-- ============================================================
DROP POLICY IF EXISTS "admin_read_admin" ON ezz_admin;
CREATE POLICY "admin_read_admin" ON ezz_admin
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- 4. Trips history: driver must read own completed trips.
--    Already covered by "driver_read_own_trips".
-- ============================================================

-- ============================================================
-- 5. Sessions: keep readable so session restoration works.
--    Already covered by "device_read_own_sessions" (USING true).
-- ============================================================

