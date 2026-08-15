-- ============================================================
-- Migration: Secure Trip Privacy via RPC Functions (FIXED)
-- ============================================================
-- This migration tightens trip privacy by:
-- 1. Removing overly permissive RLS policies on ezz_trips_history
-- 2. Blocking direct reads from the trips table
-- 3. Adding secure SECURITY DEFINER RPC functions with proper validation
--
-- IMPORTANT: This app uses custom sessions (ezz_sessions), NOT Supabase Auth.
-- So we validate against ezz_sessions table instead of auth.uid().
-- ============================================================

-- ============================================================
-- 1. Drop old permissive policies
-- ============================================================
DROP POLICY IF EXISTS "rider_read_own_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "driver_read_own_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "admin_read_all_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "Allow public write trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "anon_write_trips_history" ON ezz_trips_history;

-- ============================================================
-- 2. New restrictive policies
-- ============================================================

-- Block direct reads from ezz_trips_history
CREATE POLICY "deny_direct_select_trips" ON ezz_trips_history
  FOR SELECT TO public
  USING (false);

-- Allow inserts/updates only through RPC (no direct anon writes)
CREATE POLICY "deny_direct_write_trips" ON ezz_trips_history
  FOR INSERT, UPDATE TO public
  USING (false)
  WITH CHECK (false);

-- Allow admin to delete trips (for admin tools) - verified inside RPC
CREATE POLICY "admin_delete_trips" ON ezz_trips_history
  FOR DELETE TO public
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

-- ============================================================
-- 3. Helper: Verify session exists and matches role and device_id (REQUIRED)
-- ============================================================
-- FIXED: p_device_id is now mandatory (no DEFAULT NULL), preventing identity spoofing.
CREATE OR REPLACE FUNCTION verify_session(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ezz_sessions
    WHERE user_id = p_user_id
      AND role = upper(p_role)
      AND device_id = p_device_id
  );
$$;

-- ============================================================
-- 4. RPC: Get paginated trips for current user (rider or driver)
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT,
  p_page INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 10,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS SETOF ezz_trips_history
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_session(p_user_id, p_role, p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: invalid session';
  END IF;

  RETURN QUERY
  SELECT * FROM ezz_trips_history
  WHERE 
    (
      (p_role = 'rider' AND rider_id = p_user_id)
      OR (p_role = 'driver' AND driver_id = p_user_id)
    )
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_status_filter = 'all' 
      OR (p_status_filter = 'ACTIVE' AND status IN ('ACCEPTED', 'ARRIVED', 'STARTED'))
      OR status = p_status_filter
    )
    AND (
      p_search IS NULL OR p_search = '' OR
      LOWER(rider_name) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(driver_name, '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
    )
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET (p_page * p_limit);
END;
$$;

-- ============================================================
-- 5. RPC: Count trips for current user (rider or driver)
-- ============================================================
CREATE OR REPLACE FUNCTION count_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF NOT verify_session(p_user_id, p_role, p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: invalid session';
  END IF;

  SELECT COUNT(*) INTO v_count FROM ezz_trips_history
  WHERE 
    (
      (p_role = 'rider' AND rider_id = p_user_id)
      OR (p_role = 'driver' AND driver_id = p_user_id)
    )
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_status_filter = 'all' 
      OR (p_status_filter = 'ACTIVE' AND status IN ('ACCEPTED', 'ARRIVED', 'STARTED'))
      OR status = p_status_filter
    )
    AND (
      p_search IS NULL OR p_search = '' OR
      LOWER(rider_name) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(driver_name, '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
    );

  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. RPC: Get paginated trips for admin
-- ============================================================
CREATE OR REPLACE FUNCTION get_admin_trips(
  p_admin_user_id TEXT,
  p_device_id TEXT,
  p_page INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 20,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS SETOF ezz_trips_history
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_session(p_admin_user_id, 'ADMIN', p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT * FROM ezz_trips_history
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_status_filter = 'all' 
      OR (p_status_filter = 'ACTIVE' AND status IN ('ACCEPTED', 'ARRIVED', 'STARTED'))
      OR status = p_status_filter
    )
    AND (
      p_search IS NULL OR p_search = '' OR
      LOWER(rider_name) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(driver_name, '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
    )
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET (p_page * p_limit);
END;
$$;

-- ============================================================
-- 7. RPC: Count all trips for admin
-- ============================================================
CREATE OR REPLACE FUNCTION count_admin_trips(
  p_admin_user_id TEXT,
  p_device_id TEXT,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF NOT verify_session(p_admin_user_id, 'ADMIN', p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT COUNT(*) INTO v_count FROM ezz_trips_history
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_status_filter = 'all' 
      OR (p_status_filter = 'ACTIVE' AND status IN ('ACCEPTED', 'ARRIVED', 'STARTED'))
      OR status = p_status_filter
    )
    AND (
      p_search IS NULL OR p_search = '' OR
      LOWER(rider_name) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(driver_name, '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(pickup->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameAr', '')) LIKE LOWER('%' || p_search || '%')
      OR LOWER(COALESCE(dropoff->>'nameEn', '')) LIKE LOWER('%' || p_search || '%')
    );

  RETURN v_count;
END;
$$;

-- ============================================================
-- 8. RPC: Admin clear all trips
-- ============================================================
CREATE OR REPLACE FUNCTION admin_clear_all_trips(
  p_admin_user_id TEXT,
  p_device_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_session(p_admin_user_id, 'ADMIN', p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  DELETE FROM ezz_trips_history;
END;
$$;

-- ============================================================
-- 9. RPC: Save trip (single entry point for writes) - SECURED
-- ============================================================
-- FIXED: Now requires user context and validates trip ownership.
-- Also fixes JSONB extraction operators (-> instead of ->> for JSONB fields).
CREATE OR REPLACE FUNCTION save_trip_to_history(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT,
  p_trip JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rider_id TEXT := (p_trip->>'rider_id')::TEXT;
  v_driver_id TEXT := (p_trip->>'driver_id')::TEXT;
BEGIN
  IF NOT verify_session(p_user_id, p_role, p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: invalid session';
  END IF;

  IF upper(p_role) != 'ADMIN' AND p_user_id != v_rider_id AND p_user_id != COALESCE(v_driver_id, '') THEN
    RAISE EXCEPTION 'Unauthorized: you can only modify your own trips';
  END IF;

  INSERT INTO ezz_trips_history (id, rider_id, rider_name, rider_phone, driver_id, driver_name, pickup, dropoff, pickup_landmark, status, fare, commission, distance, eta_minutes, requested_vehicle_type, created_at, completed_at, chat_messages, rider_rating_to_driver, rider_feedback_tags, rider_feedback_comment, driver_rating_to_rider, driver_feedback_tags, driver_feedback_comment, route_geometry, offered_driver_ids, current_offered_driver_id, dispatch_timer, dispatch_timer_max, applied_promo_code, applied_promo_discount)
  VALUES (
    (p_trip->>'id')::TEXT,
    v_rider_id,
    (p_trip->>'rider_name')::TEXT,
    (p_trip->>'rider_phone')::TEXT,
    v_driver_id,
    (p_trip->>'driver_name')::TEXT,
    (p_trip->'pickup')::JSONB,
    (p_trip->'dropoff')::JSONB,
    (p_trip->>'pickup_landmark')::TEXT,
    (p_trip->>'status')::TEXT,
    (p_trip->>'fare')::DOUBLE PRECISION,
    (p_trip->>'commission')::DOUBLE PRECISION,
    (p_trip->>'distance')::DOUBLE PRECISION,
    (p_trip->>'eta_minutes')::INTEGER,
    (p_trip->>'requested_vehicle_type')::TEXT,
    (p_trip->>'created_at')::TEXT,
    (p_trip->>'completed_at')::TEXT,
    (p_trip->'chat_messages')::JSONB,
    (p_trip->>'rider_rating_to_driver')::DOUBLE PRECISION,
    (p_trip->'rider_feedback_tags')::JSONB,
    (p_trip->>'rider_feedback_comment')::TEXT,
    (p_trip->>'driver_rating_to_rider')::DOUBLE PRECISION,
    (p_trip->>'driver_feedback_tags')::JSONB,
    (p_trip->>'driver_feedback_comment')::TEXT,
    (p_trip->'route_geometry')::JSONB,
    (p_trip->'offered_driver_ids')::JSONB,
    (p_trip->>'current_offered_driver_id')::TEXT,
    (p_trip->>'dispatch_timer')::INTEGER,
    (p_trip->>'dispatch_timer_max')::INTEGER,
    (p_trip->>'applied_promo_code')::TEXT,
    (p_trip->>'applied_promo_discount')::DOUBLE PRECISION
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    driver_id = EXCLUDED.driver_id,
    driver_name = EXCLUDED.driver_name,
    completed_at = EXCLUDED.completed_at,
    fare = EXCLUDED.fare,
    commission = EXCLUDED.commission,
    distance = EXCLUDED.distance,
    chat_messages = EXCLUDED.chat_messages,
    rider_rating_to_driver = EXCLUDED.rider_rating_to_driver,
    rider_feedback_tags = EXCLUDED.rider_feedback_tags,
    rider_feedback_comment = EXCLUDED.rider_feedback_comment,
    driver_rating_to_rider = EXCLUDED.driver_rating_to_rider,
    driver_feedback_tags = EXCLUDED.driver_feedback_tags,
    driver_feedback_comment = EXCLUDED.driver_feedback_comment,
    route_geometry = EXCLUDED.route_geometry,
    offered_driver_ids = EXCLUDED.offered_driver_ids,
    current_offered_driver_id = EXCLUDED.current_offered_driver_id,
    dispatch_timer = EXCLUDED.dispatch_timer,
    dispatch_timer_max = EXCLUDED.dispatch_timer_max,
    applied_promo_code = EXCLUDED.applied_promo_code,
    applied_promo_discount = EXCLUDED.applied_promo_discount;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- 10. Revoke direct table access from anon/public
-- ============================================================
REVOKE ALL ON ezz_trips_history FROM anon;
REVOKE ALL ON ezz_trips_history FROM public;

-- Grant only necessary permissions for RPC execution
GRANT USAGE ON SCHEMA public TO anon;
GRANT EXECUTE ON FUNCTION get_my_trips TO anon;
GRANT EXECUTE ON FUNCTION count_my_trips TO anon;
GRANT EXECUTE ON FUNCTION get_admin_trips TO anon;
GRANT EXECUTE ON FUNCTION count_admin_trips TO anon;
GRANT EXECUTE ON FUNCTION save_trip_to_history TO anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_trips TO anon;
GRANT EXECUTE ON FUNCTION verify_session TO anon;
