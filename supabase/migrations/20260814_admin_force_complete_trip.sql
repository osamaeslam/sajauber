-- ============================================================
-- Add status_updated_at to ezz_active_trip for timeout tracking
-- ============================================================
ALTER TABLE ezz_active_trip ADD COLUMN IF NOT EXISTS status_updated_at TEXT DEFAULT NOW()::TEXT;

-- ============================================================
-- RPC: Admin force complete a trip (ARRIVED/STARTED -> COMPLETED)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_force_complete_trip(
  p_trip_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE ezz_active_trip
  SET
    status = 'COMPLETED',
    completed_at = COALESCE(completed_at, NOW()::TEXT),
    status_updated_at = NOW()::TEXT
  WHERE id = p_trip_id AND status IN ('ARRIVED', 'STARTED', 'SEARCHING', 'ACCEPTED');

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_force_complete_trip(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION admin_force_complete_trip(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_force_complete_trip(TEXT) TO service_role;
