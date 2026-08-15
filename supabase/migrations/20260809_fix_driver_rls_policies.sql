-- Fix driver update RLS policy to allow admin updates
-- The restrictive "driver_update_own" policy blocks admin edits because
-- it only allows updates for drivers with an active DRIVER session.
-- We expand it to also allow updates when an ADMIN session exists.

DROP POLICY IF EXISTS "anon can update drivers" ON ezz_drivers;

CREATE POLICY "driver_update_own" ON ezz_drivers
  FOR UPDATE TO anon
  USING (
    id IN (
      SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER'
    )
    OR EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

-- Also allow admin to insert drivers
DROP POLICY IF EXISTS "anon can insert drivers" ON ezz_drivers;

CREATE POLICY "admin_insert_drivers" ON ezz_drivers
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );

-- Also allow admin to delete drivers
DROP POLICY IF EXISTS "anon can delete drivers" ON ezz_drivers;

CREATE POLICY "admin_delete_drivers" ON ezz_drivers
  FOR DELETE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN'
    )
  );
