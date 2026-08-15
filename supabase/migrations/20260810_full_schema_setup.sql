-- ============================================================
-- كابتن عز - قاعدة البيانات الكاملة - قاعدة البيانات الجديدة
-- انسخ الكود بالكامل والزقه في SQL Editor بـ Supabase
-- ============================================================

-- ============================================================
-- 1. جدول المواقع
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_locations (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  city TEXT,
  country TEXT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION
);

-- ============================================================
-- 1b. جدول المناطق الإدارية
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_regions (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  country TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TEXT DEFAULT NOW()::TEXT
);

-- ============================================================
-- 2. جدول الركاب
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_riders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password TEXT,
  rating DOUBLE PRECISION DEFAULT 5.0,
  total_trips INTEGER DEFAULT 0,
  approval_status TEXT DEFAULT 'APPROVED',
  preferences JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE ezz_riders ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'APPROVED';
ALTER TABLE ezz_riders ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

-- ============================================================
-- 3. جدول الكباتن والسائقين
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password TEXT,
  car_model TEXT,
  car_plate TEXT,
  vehicle_type TEXT,
  vehicle_name TEXT,
  national_id TEXT,
  driver_license TEXT,
  personal_photo TEXT,
  national_id_image TEXT,
  driver_license_image TEXT,
  vehicle_license_image TEXT,
  is_online BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'AVAILABLE',
  approval_status TEXT DEFAULT 'PENDING',
  rating DOUBLE PRECISION DEFAULT 5.0,
  total_trips INTEGER DEFAULT 0,
  total_earnings DOUBLE PRECISION DEFAULT 0,
  total_commission_paid DOUBLE PRECISION DEFAULT 0,
  current_x DOUBLE PRECISION DEFAULT 50,
  current_y DOUBLE PRECISION DEFAULT 50,
  agreed_to_terms BOOLEAN DEFAULT false,
  last_seen TEXT DEFAULT NOW()::TEXT,
  service_areas TEXT[] DEFAULT '{}',
  auto_accept BOOLEAN DEFAULT false,
  auto_show_map BOOLEAN DEFAULT false,
  fcm_token TEXT
);

ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS last_seen TEXT DEFAULT NOW()::TEXT;
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS service_areas TEXT[] DEFAULT '{}';
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN DEFAULT false;
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS auto_show_map BOOLEAN DEFAULT false;
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- ============================================================
-- 4. جدول الرحلة الحالية النشطة
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_active_trip (
  id TEXT PRIMARY KEY,
  rider_id TEXT,
  rider_name TEXT,
  rider_phone TEXT,
  driver_id TEXT,
  driver_name TEXT,
  pickup JSONB,
  dropoff JSONB,
  status TEXT,
  fare DOUBLE PRECISION,
  commission DOUBLE PRECISION,
  distance DOUBLE PRECISION,
  created_at TEXT,
  completed_at TEXT,
  chat_messages JSONB DEFAULT '[]'::jsonb,
  rider_rating_to_driver DOUBLE PRECISION,
  rider_feedback_tags JSONB DEFAULT '[]'::jsonb,
  rider_feedback_comment TEXT,
  driver_rating_to_rider DOUBLE PRECISION,
  driver_feedback_tags JSONB DEFAULT '[]'::jsonb,
  driver_feedback_comment TEXT,
  pickup_landmark TEXT,
  eta_minutes INTEGER,
  requested_vehicle_type TEXT,
  route_geometry JSONB,
  offered_driver_ids JSONB,
  current_offered_driver_id TEXT,
  dispatch_timer INTEGER,
  dispatch_timer_max INTEGER,
  applied_promo_code TEXT,
  applied_promo_discount DOUBLE PRECISION
);

-- ============================================================
-- 5. جدول سجل الرحلات المكتملة أو الملغاة
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_trips_history (
  id TEXT PRIMARY KEY,
  rider_id TEXT,
  rider_name TEXT,
  rider_phone TEXT,
  driver_id TEXT,
  driver_name TEXT,
  pickup JSONB,
  dropoff JSONB,
  pickup_landmark TEXT,
  status TEXT,
  fare DOUBLE PRECISION,
  commission DOUBLE PRECISION,
  distance DOUBLE PRECISION,
  eta_minutes INTEGER,
  requested_vehicle_type TEXT,
  created_at TEXT,
  completed_at TEXT,
  chat_messages JSONB DEFAULT '[]'::jsonb,
  rider_rating_to_driver DOUBLE PRECISION,
  rider_feedback_tags JSONB DEFAULT '[]'::jsonb,
  rider_feedback_comment TEXT,
  driver_rating_to_rider DOUBLE PRECISION,
  driver_feedback_tags JSONB DEFAULT '[]'::jsonb,
  driver_feedback_comment TEXT,
  route_geometry JSONB,
  offered_driver_ids JSONB,
  current_offered_driver_id TEXT,
   dispatch_timer INTEGER,
   dispatch_timer_max INTEGER,
   applied_promo_code TEXT,
   applied_promo_discount DOUBLE PRECISION
 );

-- ============================================================
-- 5b. جدول الأكواد الترويجية
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 5,
  rider_id TEXT,
  trip_id TEXT,
  used BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  used_at TEXT,
  created_at TEXT DEFAULT NOW()::TEXT,
  expires_at TEXT,
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0
);

-- ============================================================
-- 6. جدول إحصائيات النظام
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_stats (
  id TEXT PRIMARY KEY,
  commission_rate DOUBLE PRECISION DEFAULT 15,
  total_revenue DOUBLE PRECISION DEFAULT 0,
  total_commission DOUBLE PRECISION DEFAULT 0,
  total_completed_trips INTEGER DEFAULT 0,
  fixed_commission DOUBLE PRECISION DEFAULT 10,
  price_per_km DOUBLE PRECISION DEFAULT 8,
  base_fare DOUBLE PRECISION DEFAULT 20,
  distance_buffer DOUBLE PRECISION DEFAULT 1.25,
  additional_km DOUBLE PRECISION DEFAULT 0.0,
  internal_commission DOUBLE PRECISION DEFAULT 10,
  external_commission DOUBLE PRECISION DEFAULT 15,
  support_whatsapp TEXT DEFAULT '201015555555',
  free_km_threshold DOUBLE PRECISION DEFAULT 2,
  short_trip_commission DOUBLE PRECISION DEFAULT 10,
  long_trip_commission DOUBLE PRECISION DEFAULT 15,
  car_base_fare DOUBLE PRECISION DEFAULT 20,
  car_price_per_km DOUBLE PRECISION DEFAULT 8,
  car_min_fare DOUBLE PRECISION DEFAULT 15,
  car_price_per_km_20to50 DOUBLE PRECISION DEFAULT 8,
  car_price_per_km_50plus DOUBLE PRECISION DEFAULT 8,
  motorcycle_base_fare DOUBLE PRECISION DEFAULT 12,
  motorcycle_price_per_km DOUBLE PRECISION DEFAULT 5,
  motorcycle_min_fare DOUBLE PRECISION DEFAULT 10,
  motorcycle_price_per_km_20to50 DOUBLE PRECISION DEFAULT 5,
  motorcycle_price_per_km_50plus DOUBLE PRECISION DEFAULT 5,
  toktok_base_fare DOUBLE PRECISION DEFAULT 10,
  toktok_price_per_km DOUBLE PRECISION DEFAULT 4,
  toktok_min_fare DOUBLE PRECISION DEFAULT 8,
  toktok_price_per_km_20to50 DOUBLE PRECISION DEFAULT 4,
  toktok_price_per_km_50plus DOUBLE PRECISION DEFAULT 4,
  tricycle_base_fare DOUBLE PRECISION DEFAULT 10,
  tricycle_price_per_km DOUBLE PRECISION DEFAULT 4,
  tricycle_min_fare DOUBLE PRECISION DEFAULT 8,
  tricycle_price_per_km_20to50 DOUBLE PRECISION DEFAULT 4,
  tricycle_price_per_km_50plus DOUBLE PRECISION DEFAULT 4,
  incoming_commission DOUBLE PRECISION DEFAULT 5,
  outgoing_commission DOUBLE PRECISION DEFAULT 5,
  incoming_commission_percent DOUBLE PRECISION DEFAULT 10,
  outgoing_commission_percent DOUBLE PRECISION DEFAULT 10,
  commission_mode TEXT DEFAULT 'fixed',
  promo_code TEXT DEFAULT 'EZZ5',
  promo_value DOUBLE PRECISION DEFAULT 5,
  low_data_mode BOOLEAN DEFAULT true
);

-- ============================================================
-- 7. جدول المديرين
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_admin (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'ADMIN',
  created_at TEXT DEFAULT NOW()
);

-- ============================================================
-- 9. جدول الجلسات (Session)
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_sessions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  updated_at TEXT
);

-- ============================================================
-- 8. جدول سجل التدقيق (Audit Logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT,
  action TEXT,
  user_id TEXT,
  user_type TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

-- ============================================================
-- 10. جدول الإعلانات للمحلات المحلية
-- ============================================================
CREATE TABLE IF NOT EXISTS ads (
  id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  offer_text TEXT NOT NULL,
  image_url TEXT,
  phone_number TEXT NOT NULL,
  whatsapp TEXT,
  placement TEXT DEFAULT 'all',
  priority INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  start_date TEXT,
  end_date TEXT,
  clicks INTEGER DEFAULT 0,
  whatsapp_clicks INTEGER DEFAULT 0,
  ad_fee DOUBLE PRECISION DEFAULT 0,
  daily_impression_limit INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  region_id TEXT,
  created_at TEXT DEFAULT NOW()::TEXT
);

-- ============================================================
-- Indexes للأداء المثالي
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_drivers_status ON ezz_drivers(status, approval_status, is_online);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON ezz_drivers(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_service_areas ON ezz_drivers USING GIN(service_areas);
CREATE INDEX IF NOT EXISTS idx_riders_phone ON ezz_riders(phone);
CREATE INDEX IF NOT EXISTS idx_trips_status ON ezz_trips_history(status);
CREATE INDEX IF NOT EXISTS idx_trips_rider ON ezz_trips_history(rider_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON ezz_trips_history(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_created ON ezz_trips_history(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_phone ON ezz_admin(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON ezz_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_role_device ON ezz_sessions(role, device_id);
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_device ON ezz_sessions(role, device_id);
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_user_id ON ezz_sessions(role, user_id);
CREATE INDEX IF NOT EXISTS idx_ezz_drivers_id ON ezz_drivers (id);
CREATE INDEX IF NOT EXISTS idx_ads_region ON ads(region_id);
CREATE INDEX IF NOT EXISTS idx_promo_code ON ezz_promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_rider ON ezz_promo_codes(rider_id);
CREATE INDEX IF NOT EXISTS idx_promo_used ON ezz_promo_codes(used);
CREATE INDEX IF NOT EXISTS idx_promo_usage ON ezz_promo_codes(usage_limit, usage_count);

-- ============================================================
-- تفعيل RLS مع Policies محسنة للأمان
-- ============================================================
ALTER TABLE IF EXISTS ezz_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_active_trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_trips_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ezz_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ads ENABLE ROW LEVEL SECURITY;

-- Locations: القراءة للجميع، الكتابة للإدمن فقط
DROP POLICY IF EXISTS "Allow public read locations" ON ezz_locations;
CREATE POLICY "public_read_locations" ON ezz_locations FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write locations" ON ezz_locations;
DROP POLICY IF EXISTS "Allow public update locations" ON ezz_locations;
DROP POLICY IF EXISTS "Allow public delete locations" ON ezz_locations;
CREATE POLICY "admin_write_locations" ON ezz_locations FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- Regions: القراءة للجميع، الكتابة للإدمن فقط
DROP POLICY IF EXISTS "Allow public read regions" ON ezz_regions;
CREATE POLICY "public_read_regions" ON ezz_regions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write regions" ON ezz_regions;
DROP POLICY IF EXISTS "Allow public update regions" ON ezz_regions;
DROP POLICY IF EXISTS "Allow public delete regions" ON ezz_regions;
CREATE POLICY "admin_write_regions" ON ezz_regions FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- Riders: القراءة للجميع، التعديل لمالك الحساب أو الإدمن
DROP POLICY IF EXISTS "Allow public read riders" ON ezz_riders;
CREATE POLICY "public_read_riders" ON ezz_riders FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write riders" ON ezz_riders;
CREATE POLICY "anon_insert_riders" ON ezz_riders FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update riders" ON ezz_riders;
CREATE POLICY "rider_update_own" ON ezz_riders FOR UPDATE TO anon USING (
  id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
);
CREATE POLICY "admin_update_riders" ON ezz_riders FOR UPDATE TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);
DROP POLICY IF EXISTS "Allow public delete riders" ON ezz_riders;
CREATE POLICY "admin_delete_riders" ON ezz_riders FOR DELETE TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);

-- Drivers: السائقين الموثقين فقط للقراءة العامة
DROP POLICY IF EXISTS "Allow public read approved drivers" ON ezz_drivers;
DROP POLICY IF EXISTS "public_read_approved_drivers" ON ezz_drivers;
CREATE POLICY "public_read_approved_drivers" ON ezz_drivers FOR SELECT USING (approval_status = 'APPROVED');
-- السائق يقدر يقرأ سجله حتى لو PENDING (مهم لتسجيل الدخول)
DROP POLICY IF EXISTS "driver_read_own" ON ezz_drivers;
CREATE POLICY "driver_read_own" ON ezz_drivers FOR SELECT TO anon USING (
  id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
);
-- الإدمن يقرأ كل السائقين بمن فيهم PENDING/REJECTED/FROZEN للمراجعة
DROP POLICY IF EXISTS "admin_read_all_drivers" ON ezz_drivers;
CREATE POLICY "admin_read_all_drivers" ON ezz_drivers FOR SELECT TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);
DROP POLICY IF EXISTS "Allow public write drivers" ON ezz_drivers;
CREATE POLICY "anon_insert_drivers" ON ezz_drivers FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update drivers" ON ezz_drivers;
CREATE POLICY "driver_update_own" ON ezz_drivers FOR UPDATE TO anon USING (
  id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
);
CREATE POLICY "admin_update_drivers" ON ezz_drivers FOR UPDATE TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);
DROP POLICY IF EXISTS "Allow public delete drivers" ON ezz_drivers;
CREATE POLICY "admin_delete_drivers" ON ezz_drivers FOR DELETE TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);

-- Active Trip: القراءة للجميع (مطلوب لـ Realtime)، الكتابة للجميع
DROP POLICY IF EXISTS "Deny anon read active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "Allow anon read active_trip" ON ezz_active_trip;
CREATE POLICY "anon_read_active_trip" ON ezz_active_trip FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write active_trip" ON ezz_active_trip;
CREATE POLICY "anon_write_active_trip" ON ezz_active_trip FOR ALL TO anon USING (true) WITH CHECK (true);

-- تفعيل Realtime على جدول الرحلة النشطة
ALTER PUBLICATION supabase_realtime ADD TABLE ezz_active_trip;
ALTER PUBLICATION supabase_realtime ADD TABLE ezz_promo_codes;

-- Trips History: منع القراءة المباشرة، واستخدام RPC functions فقط للعزل
DROP POLICY IF EXISTS "Allow public read trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "rider_read_own_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "driver_read_own_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "admin_read_all_trips" ON ezz_trips_history;
DROP POLICY IF EXISTS "Allow public write trips_history" ON ezz_trips_history;
DROP POLICY IF EXISTS "anon_write_trips_history" ON ezz_trips_history;

CREATE POLICY "deny_anon_read_trips" ON ezz_trips_history
  FOR SELECT TO anon
  USING (false);

CREATE POLICY "anon_write_trips" ON ezz_trips_history
  FOR INSERT, UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "admin_delete_trips" ON ezz_trips_history
  FOR DELETE TO anon
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

-- Stats: القراءة للجميع، التعديل للإدمن فقط
DROP POLICY IF EXISTS "Allow public read stats" ON ezz_stats;
CREATE POLICY "public_read_stats" ON ezz_stats FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public update stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public delete stats" ON ezz_stats;
CREATE POLICY "admin_write_stats" ON ezz_stats FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- Admin: القراءة متاحة لتسجيل الدخول الأول
DROP POLICY IF EXISTS "Allow public read admin" ON ezz_admin;
DROP POLICY IF EXISTS "admin_read_admin" ON ezz_admin;
CREATE POLICY "admin_read_admin" ON ezz_admin FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow public write admin" ON ezz_admin;
DROP POLICY IF EXISTS "Allow public update admin" ON ezz_admin;
DROP POLICY IF EXISTS "Allow public delete admin" ON ezz_admin;
CREATE POLICY "admin_write_admin" ON ezz_admin FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- Audit Logs: الإدمن فقط يقرأ، الجميع يكتب
DROP POLICY IF EXISTS "Deny anon read audit_logs" ON ezz_audit_logs;
CREATE POLICY "admin_read_audit_logs" ON ezz_audit_logs FOR SELECT TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
);
DROP POLICY IF EXISTS "Allow public write audit_logs" ON ezz_audit_logs;
CREATE POLICY "anon_write_audit_logs" ON ezz_audit_logs FOR INSERT TO anon WITH CHECK (true);

-- Sessions: القراءة والكتابة للتسجيل
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
-- Do NOT expose the full `ezz_sessions` table to the anonymous role.
-- Clients must use the SECURITY DEFINER RPC `get_session_by_device(device_id)` instead.
-- Allow anonymous clients to INSERT a session (for initial registration/login) but deny direct SELECT/UPDATE/DELETE.
CREATE POLICY "deny_anon_read_sessions" ON ezz_sessions FOR SELECT TO anon USING (false);
CREATE POLICY "anon_insert_sessions" ON ezz_sessions FOR INSERT TO anon WITH CHECK (true);

-- Promo Codes: القراءة للكودات النشطة، الكتابة للإدمن
DROP POLICY IF EXISTS "Allow anon read promo_codes" ON ezz_promo_codes;
CREATE POLICY "public_read_active_promo_codes" ON ezz_promo_codes FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Allow anon insert promo_codes" ON ezz_promo_codes;
DROP POLICY IF EXISTS "Allow anon update promo_codes" ON ezz_promo_codes;
DROP POLICY IF EXISTS "Allow anon delete promo_codes" ON ezz_promo_codes;
CREATE POLICY "admin_write_promo_codes" ON ezz_promo_codes FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- Ads: القراءة للإعلانات النشطة، الكتابة للإدمن
DROP POLICY IF EXISTS "Allow public read ads" ON ads;
CREATE POLICY "public_read_ads" ON ads FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Allow public write ads" ON ads;
DROP POLICY IF EXISTS "Allow public update ads" ON ads;
DROP POLICY IF EXISTS "Allow public delete ads" ON ads;
CREATE POLICY "admin_write_ads" ON ads FOR ALL TO anon USING (
  EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
) WITH CHECK (true);

-- ============================================================
-- دوال زيادة عدادات الإعلانات
-- ============================================================
CREATE OR REPLACE FUNCTION increment_ad_click(ad_id TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ads SET clicks = clicks + 1 WHERE id = ad_id;
END $$;

CREATE OR REPLACE FUNCTION increment_ad_whatsapp(ad_id TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ads SET whatsapp_clicks = COALESCE(whatsapp_clicks, 0) + 1 WHERE id = ad_id;
END $$;

CREATE OR REPLACE FUNCTION increment_ad_impression(ad_id TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ads SET impressions = COALESCE(impressions, 0) + 1 WHERE id = ad_id;
END $$;

-- ============================================================
-- Helper function to set role per-request
-- ============================================================
CREATE OR REPLACE FUNCTION set_app_role(role TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_role', role, false);
END;
$$;

-- Helper RPC to securely return a session matching a device_id
-- This runs as the DB owner (SECURITY DEFINER) and avoids exposing the
-- entire ezz_sessions table via permissive RLS policies.
CREATE OR REPLACE FUNCTION get_session_by_device(p_device_id TEXT)
RETURNS TABLE(role TEXT, user_id TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT role, user_id FROM ezz_sessions
  WHERE device_id = p_device_id
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_session_by_device(TEXT) TO anon;

-- ============================================================
-- RPC: Get paginated trips for current user (rider or driver)
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_page INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 10,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS SETOF ezz_trips_history
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM ezz_trips_history
  WHERE
    (p_role = 'rider' AND rider_id = p_user_id)
    OR (p_role = 'driver' AND driver_id = p_user_id)
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
$$;

-- ============================================================
-- RPC: Count trips for current user (rider or driver)
-- ============================================================
CREATE OR REPLACE FUNCTION count_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*) FROM ezz_trips_history
  WHERE
    (p_role = 'rider' AND rider_id = p_user_id)
    OR (p_role = 'driver' AND driver_id = p_user_id)
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
$$;

-- ============================================================
-- RPC: Get paginated trips for admin (all trips with filtering)
-- ============================================================
CREATE OR REPLACE FUNCTION get_admin_trips(
  p_page INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 20,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS SETOF ezz_trips_history
LANGUAGE sql
SECURITY DEFINER
AS $$
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
$$;

-- ============================================================
-- RPC: Count all trips for admin
-- ============================================================
CREATE OR REPLACE FUNCTION count_admin_trips(
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL,
  p_status_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*) FROM ezz_trips_history
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
$$;

-- ============================================================
-- RPC: Admin clear all trips
-- ============================================================
CREATE OR REPLACE FUNCTION admin_clear_all_trips()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM ezz_trips_history;
$$;

-- ============================================================
-- SECURITY DEFINER functions for driver admin operations
-- (bypasses RLS to avoid connection pooling issues)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_update_driver(
  p_driver_id TEXT,
  p_data JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ezz_drivers
  SET
    approval_status = COALESCE(p_data->>'approval_status', approval_status),
    is_online       = COALESCE((p_data->>'is_online')::BOOLEAN, is_online)
  WHERE id = p_driver_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_driver_approval(
  p_driver_id TEXT,
  p_approval_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ezz_drivers
  SET approval_status = p_approval_status
  WHERE id = p_driver_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO service_role;

-- ============================================================
-- Storage bucket setup instructions:
-- ============================================================
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Create a new bucket named: driver-documents
-- 3. Set it to PUBLIC
-- 4. Add the following policies in Storage -> Policies:
--
--    Policy 1: Allow public uploads
--    CREATE POLICY "anon_upload_driver_docs" ON storage.objects
--      FOR INSERT TO anon WITH CHECK (bucket_id = 'driver-documents');
--
--    Policy 2: Allow public reads
--    CREATE POLICY "anon_read_driver_docs" ON storage.objects
--      FOR SELECT TO anon USING (bucket_id = 'driver-documents');
--
--    Policy 3: Allow public updates
--    CREATE POLICY "anon_update_driver_docs" ON storage.objects
--      FOR UPDATE TO anon USING (bucket_id = 'driver-documents');
--
--    Policy 4: Allow public deletes
--    CREATE POLICY "anon_delete_driver_docs" ON storage.objects
--      FOR DELETE TO anon USING (bucket_id = 'driver-documents');
-- ============================================================
