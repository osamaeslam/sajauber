-- ============================================================
-- Trip Queue System
-- ============================================================

-- Queue table for pending trip requests waiting for driver assignment
CREATE TABLE IF NOT EXISTS ezz_trip_queue (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  rider_id TEXT NOT NULL,
  rider_name TEXT NOT NULL,
  rider_phone TEXT NOT NULL,
  pickup JSONB NOT NULL,
  dropoff JSONB NOT NULL,
  pickup_landmark TEXT,
  fare DOUBLE PRECISION NOT NULL,
  commission DOUBLE PRECISION NOT NULL,
  distance DOUBLE PRECISION,
  eta_minutes INTEGER,
  requested_vehicle_type TEXT,
  status TEXT DEFAULT 'WAITING',
  priority INTEGER DEFAULT 0,
  offered_driver_ids JSONB DEFAULT '[]'::jsonb,
  current_offered_driver_id TEXT,
  dispatch_timer INTEGER DEFAULT 300,
  dispatch_timer_max INTEGER DEFAULT 300,
  applied_promo_code TEXT,
  applied_promo_discount DOUBLE PRECISION DEFAULT 0,
  pickup_region_id TEXT,
  pickup_region_name TEXT,
  created_at TEXT DEFAULT NOW()::TEXT,
  updated_at TEXT DEFAULT NOW()::TEXT
);

ALTER TABLE ezz_trip_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_own_queue" ON ezz_trip_queue FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_queue" ON ezz_trip_queue FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_queue" ON ezz_trip_queue FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_queue" ON ezz_trip_queue FOR DELETE TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_trip_queue_status ON ezz_trip_queue(status);
CREATE INDEX IF NOT EXISTS idx_trip_queue_rider ON ezz_trip_queue(rider_id);
CREATE INDEX IF NOT EXISTS idx_trip_queue_driver ON ezz_trip_queue(current_offered_driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_queue_created ON ezz_trip_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_trip_queue_priority ON ezz_trip_queue(priority DESC, created_at ASC);

ALTER PUBLICATION supabase_realtime ADD TABLE ezz_trip_queue;

-- ============================================================
-- Queue RPC Functions
-- ============================================================

CREATE OR REPLACE FUNCTION add_trip_to_queue(p_trip JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO ezz_trip_queue (
    id, trip_id, rider_id, rider_name, rider_phone, pickup, dropoff,
    pickup_landmark, fare, commission, distance, eta_minutes,
    requested_vehicle_type, status, priority, offered_driver_ids,
    current_offered_driver_id, dispatch_timer, dispatch_timer_max,
    applied_promo_code, applied_promo_discount, pickup_region_id, pickup_region_name
  ) VALUES (
    (p_trip->>'id')::TEXT,
    (p_trip->>'id')::TEXT,
    (p_trip->>'rider_id')::TEXT,
    (p_trip->>'rider_name')::TEXT,
    (p_trip->>'rider_phone')::TEXT,
    (p_trip->'pickup')::JSONB,
    (p_trip->'dropoff')::JSONB,
    (p_trip->>'pickup_landmark')::TEXT,
    (p_trip->>'fare')::DOUBLE PRECISION,
    (p_trip->>'commission')::DOUBLE PRECISION,
    (p_trip->>'distance')::DOUBLE PRECISION,
    (p_trip->>'eta_minutes')::INTEGER,
    (p_trip->>'requested_vehicle_type')::TEXT,
    'WAITING',
    COALESCE((p_trip->>'priority')::INTEGER, 0),
    COALESCE((p_trip->>'offered_driver_ids')::JSONB, '[]'::jsonb),
    (p_trip->>'current_offered_driver_id')::TEXT,
    COALESCE((p_trip->>'dispatch_timer')::INTEGER, 300),
    COALESCE((p_trip->>'dispatch_timer_max')::INTEGER, 300),
    (p_trip->>'applied_promo_code')::TEXT,
    COALESCE((p_trip->>'applied_promo_discount')::DOUBLE PRECISION, 0),
    (p_trip->>'pickup_region_id')::TEXT,
    (p_trip->>'pickup_region_name')::TEXT
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    offered_driver_ids = EXCLUDED.offered_driver_ids,
    current_offered_driver_id = EXCLUDED.current_offered_driver_id,
    dispatch_timer = EXCLUDED.dispatch_timer,
    updated_at = NOW()::TEXT;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_trip_to_queue(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION add_trip_to_queue(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION add_trip_to_queue(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION get_next_queued_trip(p_driver_id TEXT, p_region_id TEXT DEFAULT NULL)
RETURNS SETOF ezz_trip_queue LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM ezz_trip_queue
  WHERE status = 'WAITING'
    AND (pickup_region_id = p_region_id OR p_region_id IS NULL)
    AND (
      current_offered_driver_id IS NULL
      OR current_offered_driver_id = p_driver_id
      OR NOT (offered_driver_ids @> (ARRAY[p_driver_id])::jsonb)
    )
  ORDER BY priority DESC, created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_next_queued_trip(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_next_queued_trip(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_queued_trip(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION remove_trip_from_queue(p_trip_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM ezz_trip_queue WHERE id = p_trip_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_trip_from_queue(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION remove_trip_from_queue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_trip_from_queue(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION get_my_queued_trips_count(p_rider_id TEXT)
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COUNT(*) FROM ezz_trip_queue
  WHERE rider_id = p_rider_id AND status IN ('WAITING', 'OFFERED');
$$;

GRANT EXECUTE ON FUNCTION get_my_queued_trips_count(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_my_queued_trips_count(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_queued_trips_count(TEXT) TO service_role;

-- Process trip queue: assign waiting trips to available drivers
CREATE OR REPLACE FUNCTION process_trip_queue()
RETURNS TABLE(
  processed_count BIGINT,
  assigned_count BIGINT,
  expired_count BIGINT,
  no_drivers_count BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_processed BIGINT := 0;
  v_assigned BIGINT := 0;
  v_expired BIGINT := 0;
  v_no_drivers BIGINT := 0;
  v_trip RECORD;
  v_driver RECORD;
  v_offered JSONB;
BEGIN
  FOR v_trip IN
    SELECT * FROM ezz_trip_queue
    WHERE status = 'WAITING'
    ORDER BY priority DESC, created_at ASC
  LOOP
    v_processed := v_processed + 1;

    IF v_trip.dispatch_timer <= 0 THEN
      UPDATE ezz_trip_queue SET status = 'EXPIRED', updated_at = NOW()::TEXT WHERE id = v_trip.id;
      UPDATE ezz_active_trip SET status = 'CANCELLED', completed_at = NOW()::TEXT WHERE id = v_trip.trip_id AND status = 'SEARCHING';
      v_expired := v_expired + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_driver FROM ezz_drivers
    WHERE approval_status = 'APPROVED'
      AND is_online = true
      AND status = 'AVAILABLE'
      AND (vehicle_type = v_trip.requested_vehicle_type OR v_trip.requested_vehicle_type IS NULL)
      AND id != COALESCE(v_trip.current_offered_driver_id, '')
      AND (
        v_trip.offered_driver_ids IS NULL
        OR NOT (v_trip.offered_driver_ids @> (ARRAY[v_driver.id])::jsonb)
      )
    ORDER BY rating DESC
    LIMIT 1;

    IF v_driver.id IS NULL THEN
      IF (v_trip.dispatch_timer_max - v_trip.dispatch_timer) > 300 THEN
        UPDATE ezz_trip_queue SET status = 'NO_DRIVERS', updated_at = NOW()::TEXT WHERE id = v_trip.id;
        UPDATE ezz_active_trip SET status = 'CANCELLED', completed_at = NOW()::TEXT WHERE id = v_trip.trip_id AND status = 'SEARCHING';
        v_no_drivers := v_no_drivers + 1;
      ELSE
        UPDATE ezz_trip_queue SET dispatch_timer = dispatch_timer - 30, updated_at = NOW()::TEXT WHERE id = v_trip.id;
      END IF;
      CONTINUE;
    END IF;

    v_offered := COALESCE(v_trip.offered_driver_ids, '[]'::jsonb) || to_jsonb(ARRAY[v_driver.id]);

    UPDATE ezz_trip_queue SET
      current_offered_driver_id = v_driver.id,
      offered_driver_ids = v_offered,
      status = 'OFFERED',
      updated_at = NOW()::TEXT
    WHERE id = v_trip.id;

    UPDATE ezz_active_trip SET
      current_offered_driver_id = v_driver.id,
      offered_driver_ids = v_offered,
      dispatch_timer = v_trip.dispatch_timer - 30
    WHERE id = v_trip.trip_id AND status = 'SEARCHING';

    v_assigned := v_assigned + 1;
  END LOOP;

  processed_count := v_processed;
  assigned_count := v_assigned;
  expired_count := v_expired;
  no_drivers_count := v_no_drivers;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION process_trip_queue() TO anon;
GRANT EXECUTE ON FUNCTION process_trip_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION process_trip_queue() TO service_role;
