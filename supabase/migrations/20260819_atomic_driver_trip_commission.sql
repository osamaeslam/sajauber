-- =========================================================================
-- Migration: Atomic Driver Trip Completion & Commission Transaction Handler
-- =========================================================================

CREATE OR REPLACE FUNCTION record_driver_trip_completion(
  p_driver_id TEXT,
  p_net_earnings DOUBLE PRECISION,
  p_commission DOUBLE PRECISION,
  p_rider_id TEXT DEFAULT NULL,
  p_trip_fare DOUBLE PRECISION DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_driver ezz_drivers%ROWTYPE;
  v_rider ezz_riders%ROWTYPE;
  v_new_trips INT;
  v_new_earnings DOUBLE PRECISION;
  v_new_commission DOUBLE PRECISION;
BEGIN
  -- 1. Atomic driver update with row lock
  SELECT * INTO v_driver FROM ezz_drivers WHERE id = p_driver_id FOR UPDATE;

  IF FOUND THEN
    v_new_trips := COALESCE(v_driver.total_trips, 0) + 1;
    v_new_earnings := COALESCE(v_driver.total_earnings, 0) + p_net_earnings;
    v_new_commission := COALESCE(v_driver.total_commission_paid, 0) + p_commission;

    UPDATE ezz_drivers
    SET
      status = 'AVAILABLE',
      is_online = TRUE,
      total_trips = v_new_trips,
      total_earnings = v_new_earnings,
      total_commission_paid = v_new_commission,
      last_seen = NOW()::TEXT
    WHERE id = p_driver_id;
  ELSE
    -- If driver not found in DB yet, create minimal record
    v_new_trips := 1;
    v_new_earnings := p_net_earnings;
    v_new_commission := p_commission;

    INSERT INTO ezz_drivers (
      id, name, phone, status, is_online, total_trips, total_earnings, total_commission_paid, approval_status, last_seen
    ) VALUES (
      p_driver_id, 'Captain', '', 'AVAILABLE', TRUE, v_new_trips, v_new_earnings, v_new_commission, 'APPROVED', NOW()::TEXT
    )
    ON CONFLICT (id) DO UPDATE
    SET
      status = 'AVAILABLE',
      is_online = TRUE,
      total_trips = COALESCE(ezz_drivers.total_trips, 0) + 1,
      total_earnings = COALESCE(ezz_drivers.total_earnings, 0) + p_net_earnings,
      total_commission_paid = COALESCE(ezz_drivers.total_commission_paid, 0) + p_commission,
      last_seen = NOW()::TEXT;
  END IF;

  -- 2. Atomic rider update if rider_id provided
  IF p_rider_id IS NOT NULL AND length(p_rider_id) > 0 THEN
    UPDATE ezz_riders
    SET total_trips = COALESCE(total_trips, 0) + 1
    WHERE id = p_rider_id;
  END IF;

  -- 3. Atomic system stats update
  UPDATE ezz_stats
  SET
    total_revenue = COALESCE(total_revenue, 0) + p_trip_fare,
    total_commission = COALESCE(total_commission, 0) + p_commission,
    total_completed_trips = COALESCE(total_completed_trips, 0) + 1,
    updated_at = NOW()::TEXT;

  RETURN jsonb_build_object(
    'success', TRUE,
    'driver_id', p_driver_id,
    'total_earnings', v_new_earnings,
    'total_commission_paid', v_new_commission,
    'total_trips', v_new_trips
  );
END;
$$;

GRANT EXECUTE ON FUNCTION record_driver_trip_completion(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION) TO anon;
GRANT EXECUTE ON FUNCTION record_driver_trip_completion(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION record_driver_trip_completion(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION) TO service_role;
