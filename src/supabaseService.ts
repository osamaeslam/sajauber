import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Driver, Rider, Location, Trip, SystemStats, Admin, RiderPreferences, AuditLogEntry, PromoCode, Region, RegionPricing, Ad } from './types';
import { PAGINATION_PAGE_SIZE } from './constants';
import { verifyPassword, isSecureHash, hashPassword, generateUUID } from './utils/security';

const PAGE_SIZE = PAGINATION_PAGE_SIZE;

const RETRYABLE_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303', '57P01', '57P02', '57P03', 'XX000']);

async function withRetry<T>(
  fn: () => any,
  retries = 2,
  baseDelay = 600
): Promise<{ data: T | null; error: any }> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (!result.error) return result;
      const code = result.error.code || '';
      const msg = result.error.message || '';
      const isRetryable = RETRYABLE_CODES.has(code) || /timed out|connection pool|acquiring connection|cancel/i.test(msg);
      if (!isRetryable || attempt === retries) return result;
      lastError = result.error;
    } catch (err: any) {
      if (attempt === retries) return { data: null, error: err };
      lastError = err;
    }
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 300;
    await new Promise(r => setTimeout(r, delay));
  }
  return { data: null, error: lastError };
}

// Helper to determine if we can connect to Supabase
let isSupabaseHealthy = false;

export const checkSupabaseConnection = async (): Promise<boolean> => {
  if (!isSupabaseConfigured) {
    isSupabaseHealthy = false;
    return false;
  }
  try {
    const { error } = await supabase.from('ezz_locations').select('id').limit(1);
    if (error && error.code === 'PGRST116') {
      isSupabaseHealthy = true;
      return true;
    }
    if (error) {
      console.warn('Supabase Connection check failed, falling back to LocalStorage:', error.message);
      isSupabaseHealthy = false;
      return false;
    }
    isSupabaseHealthy = true;
    return true;
  } catch (err) {
    console.warn('Supabase not fully configured or unreachable:', err);
    isSupabaseHealthy = false;
    return false;
  }
};

export const getSupabaseStatus = () => isSupabaseHealthy;

const DRIVER_IMAGES_BUCKET = 'driver-documents';
const MAX_IMAGE_WIDTH = 800;
const IMAGE_QUALITY = 0.6;

function compressImageFile(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compression failed'));
          const out = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(out);
        },
        'image/jpeg',
        IMAGE_QUALITY
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadDriverImage(
  file: File,
  driverId: string,
  type: 'personal' | 'national' | 'license' | 'vehicle'
): Promise<string | null> {
  try {
    const compressed = await compressImageFile(file);
    const ext = compressed.name.split('.').pop() || 'jpg';
    const path = `${driverId}/${type}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(DRIVER_IMAGES_BUCKET)
      .upload(path, compressed, { cacheControl: '3600', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from(DRIVER_IMAGES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (err: any) {
    console.warn('[uploadDriverImage] Storage upload failed, falling back to base64:', err.message);
    return toBase64(file).catch(() => null);
  }
}

export async function uploadDriverImageFromBase64(
  base64: string,
  driverId: string,
  type: 'personal' | 'national' | 'license' | 'vehicle'
): Promise<string> {
  if (!base64 || !base64.startsWith('data:')) return base64;
  try {
    const res = await fetch(base64);
    const blob = await res.blob();
    const ext = blob.type.split('/')[1] || 'jpg';
    const file = new File([blob], `upload.${ext}`, { type: blob.type });
    const url = await uploadDriverImage(file, driverId, type);
    return url || base64;
  } catch {
    return base64;
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// SQL initialization schema for user convenience
export const SQL_SCHEMA = `-- كابتن عز - قاعدة البيانات الكاملة - انسخ الكود بالكامل والزقه في SQL Editor بـ Supabase

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
  pricing JSONB,
  created_at TEXT DEFAULT NOW()::TEXT
);

ALTER TABLE IF EXISTS ezz_regions ADD COLUMN IF NOT EXISTS pricing JSONB;

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

-- تفعيل Realtime على جدول السواق (مطلوب لمزامنة حالة السواق مع الراكب فوراً)
ALTER PUBLICATION supabase_realtime ADD TABLE ezz_drivers;

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

ALTER PUBLICATION supabase_realtime ADD TABLE ezz_promo_codes;

ALTER TABLE ezz_promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read promo_codes" ON ezz_promo_codes;
CREATE POLICY "Allow anon read promo_codes" ON ezz_promo_codes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon insert promo_codes" ON ezz_promo_codes;
CREATE POLICY "Allow anon insert promo_codes" ON ezz_promo_codes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update promo_codes" ON ezz_promo_codes;
CREATE POLICY "Allow anon update promo_codes" ON ezz_promo_codes FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon delete promo_codes" ON ezz_promo_codes;
CREATE POLICY "Allow anon delete promo_codes" ON ezz_promo_codes FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_promo_code ON ezz_promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_rider ON ezz_promo_codes(rider_id);
CREATE INDEX IF NOT EXISTS idx_promo_used ON ezz_promo_codes(used);
CREATE INDEX IF NOT EXISTS idx_promo_usage ON ezz_promo_codes(usage_limit, usage_count);

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

-- الترحيل التلقائي للأعمدة في حال كان الجدول موجود مسبقاً
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS distance_buffer DOUBLE PRECISION DEFAULT 1.25;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS additional_km DOUBLE PRECISION DEFAULT 0.0;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS internal_commission DOUBLE PRECISION DEFAULT 10;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS external_commission DOUBLE PRECISION DEFAULT 15;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS support_whatsapp TEXT DEFAULT '201015555555';
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS car_base_fare DOUBLE PRECISION DEFAULT 20;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS car_price_per_km DOUBLE PRECISION DEFAULT 8;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS car_min_fare DOUBLE PRECISION DEFAULT 2;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS car_price_per_km_20to50 DOUBLE PRECISION DEFAULT 8;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS car_price_per_km_50plus DOUBLE PRECISION DEFAULT 8;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS motorcycle_base_fare DOUBLE PRECISION DEFAULT 12;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS motorcycle_price_per_km DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS motorcycle_min_fare DOUBLE PRECISION DEFAULT 2;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS motorcycle_price_per_km_20to50 DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS motorcycle_price_per_km_50plus DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS toktok_base_fare DOUBLE PRECISION DEFAULT 10;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS toktok_price_per_km DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS toktok_min_fare DOUBLE PRECISION DEFAULT 2;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS toktok_price_per_km_20to50 DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS toktok_price_per_km_50plus DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS tricycle_base_fare DOUBLE PRECISION DEFAULT 10;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS tricycle_price_per_km DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS tricycle_min_fare DOUBLE PRECISION DEFAULT 2;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS tricycle_price_per_km_20to50 DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS tricycle_price_per_km_50plus DOUBLE PRECISION DEFAULT 4;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS incoming_commission DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS outgoing_commission DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS incoming_commission_percent DOUBLE PRECISION DEFAULT 10;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS outgoing_commission_percent DOUBLE PRECISION DEFAULT 10;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS commission_mode TEXT DEFAULT 'fixed';
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS promo_code TEXT DEFAULT 'EZZ5';
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS promo_value DOUBLE PRECISION DEFAULT 5;
ALTER TABLE IF EXISTS ezz_stats ADD COLUMN IF NOT EXISTS low_data_mode BOOLEAN DEFAULT true;

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
-- 9. جدول الجلسات (Session) - يبقى المستخدم مسجلاً حتى بعد التحديث/الخروج من التبويب
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_sessions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL, -- 'RIDER' | 'DRIVER' | 'ADMIN'
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

CREATE INDEX IF NOT EXISTS idx_ads_region ON ads(region_id);

-- دوال زيادة عدادات الإعلانات (تستخدمها الواجهة عند الضغط/المشاهدة)
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

ALTER TABLE IF EXISTS ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read ads" ON ads;
CREATE POLICY "Allow public read ads" ON ads FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write ads" ON ads;
CREATE POLICY "Allow public write ads" ON ads FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update ads" ON ads;
CREATE POLICY "Allow public update ads" ON ads FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Allow public delete ads" ON ads;
CREATE POLICY "Allow public delete ads" ON ads FOR DELETE USING (true);

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

-- ============================================================
-- تفعيل RLS مع Policies محسنة للأمان
-- ملاحظة: بما أننا نستخدم anon key من العميل مباشرة،
-- نعزل البيانات حسب role عبر جدول sessions
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

-- Active Trip: قراءة للرحلة/السائق/أدمن، تعديل للرحلة/السائق المعين/أدمن
DROP POLICY IF EXISTS "Deny anon read active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "Allow anon read active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "anon_read_active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "anon_write_active_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "rider_read_own_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "driver_read_assigned_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "admin_read_all_trips" ON ezz_active_trip;
DROP POLICY IF EXISTS "driver_accept_searching_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "driver_update_assigned_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "rider_update_own_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "admin_update_all_trips" ON ezz_active_trip;
DROP POLICY IF EXISTS "rider_insert_own_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "rider_delete_own_trip" ON ezz_active_trip;
DROP POLICY IF EXISTS "admin_delete_all_trips" ON ezz_active_trip;

CREATE POLICY "rider_read_own_trip" ON ezz_active_trip
  FOR SELECT TO anon
  USING (
    rider_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
  );

CREATE POLICY "driver_read_assigned_trip" ON ezz_active_trip
  FOR SELECT TO anon
  USING (
    driver_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
  );

CREATE POLICY "admin_read_all_trips" ON ezz_active_trip
  FOR SELECT TO anon
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

CREATE POLICY "driver_accept_searching_trip" ON ezz_active_trip
  FOR UPDATE TO anon
  USING (
    status = 'SEARCHING'
    AND EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'DRIVER')
  )
  WITH CHECK (
    driver_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
    AND status IN ('ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')
  );

CREATE POLICY "driver_update_assigned_trip" ON ezz_active_trip
  FOR UPDATE TO anon
  USING (
    driver_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
  )
  WITH CHECK (
    driver_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'DRIVER')
  );

CREATE POLICY "rider_update_own_trip" ON ezz_active_trip
  FOR UPDATE TO anon
  USING (
    rider_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
  )
  WITH CHECK (
    rider_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
  );

CREATE POLICY "admin_update_all_trips" ON ezz_active_trip
  FOR UPDATE TO anon
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

CREATE POLICY "rider_insert_own_trip" ON ezz_active_trip
  FOR INSERT TO anon
  WITH CHECK (
    rider_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
  );

CREATE POLICY "rider_delete_own_trip" ON ezz_active_trip
  FOR DELETE TO anon
  USING (
    rider_id IN (SELECT user_id FROM ezz_sessions WHERE role = 'RIDER')
  );

CREATE POLICY "admin_delete_all_trips" ON ezz_active_trip
  FOR DELETE TO anon
  USING (
    EXISTS (SELECT 1 FROM ezz_sessions WHERE role = 'ADMIN')
  );

-- تفعيل Realtime على جدول الرحلة النشطة (مطلوب لوصول الطلب للسائق فوراً)
ALTER PUBLICATION supabase_realtime ADD TABLE ezz_active_trip;

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

-- RPC: Get paginated trips for current user (rider or driver)
CREATE OR REPLACE FUNCTION get_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT DEFAULT NULL,
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

-- RPC: Count trips for current user (rider or driver)
CREATE OR REPLACE FUNCTION count_my_trips(
  p_user_id TEXT,
  p_role TEXT,
  p_device_id TEXT DEFAULT NULL,
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

-- RPC: Get paginated trips for admin (all trips with filtering)
-- SECURITY: requires valid admin session via verify_session
CREATE OR REPLACE FUNCTION get_admin_trips(
  p_admin_user_id TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
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

-- RPC: Count all trips for admin
-- SECURITY: requires valid admin session via verify_session
CREATE OR REPLACE FUNCTION count_admin_trips(
  p_admin_user_id TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
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

-- RPC: Admin clear all trips
-- SECURITY: requires valid admin session via verify_session
CREATE OR REPLACE FUNCTION admin_clear_all_trips(
  p_admin_user_id TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL
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

-- Helper: verify session exists
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

-- Save trip to history (single entry point for writes)
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
    (p_trip->>'rider_feedback_tags')::JSONB,
    (p_trip->>'rider_feedback_comment')::TEXT,
    (p_trip->>'driver_rating_to_rider')::DOUBLE PRECISION,
    (p_trip->>'driver_feedback_tags')::JSONB,
    (p_trip->>'driver_feedback_comment')::TEXT,
    (p_trip->>'route_geometry')::JSONB,
    (p_trip->>'offered_driver_ids')::JSONB,
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

GRANT EXECUTE ON FUNCTION verify_session(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_session(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_session(TEXT, TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION save_trip_to_history(TEXT, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION save_trip_to_history(TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION save_trip_to_history(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Stats: القراءة للجميع، والكتابة متاحة لضمان حفظ أسعار النظام
DROP POLICY IF EXISTS "Allow public read stats" ON ezz_stats;
DROP POLICY IF EXISTS "public_read_stats" ON ezz_stats;
CREATE POLICY "public_read_stats" ON ezz_stats FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public update stats" ON ezz_stats;
DROP POLICY IF EXISTS "Allow public delete stats" ON ezz_stats;
DROP POLICY IF EXISTS "admin_write_stats" ON ezz_stats;
DROP POLICY IF EXISTS "anon_write_stats" ON ezz_stats;
CREATE POLICY "anon_write_stats" ON ezz_stats FOR ALL TO anon USING (true) WITH CHECK (true);

-- Admin: القراءة متاحة لتسجيل الدخول الأول (كلمة السر مشفرة PBKDF2 والتحقق يتم في الـ client)
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
CREATE POLICY "anon_read_sessions" ON ezz_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_sessions" ON ezz_sessions FOR ALL TO anon USING (true) WITH CHECK (true);

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
-- Push Subscriptions table for Web Push notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS ezz_push_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  driver_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ezz_push_subscriptions_driver_id ON ezz_push_subscriptions(driver_id);
CREATE INDEX IF NOT EXISTS idx_ezz_push_subscriptions_endpoint ON ezz_push_subscriptions(endpoint);

ALTER TABLE ezz_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can select push subscriptions" ON ezz_push_subscriptions FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert push subscriptions" ON ezz_push_subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update push subscriptions" ON ezz_push_subscriptions FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete push subscriptions" ON ezz_push_subscriptions FOR DELETE TO anon USING (true);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at ON ezz_push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at
BEFORE UPDATE ON ezz_push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Additional Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON ezz_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_role_device ON ezz_sessions(role, device_id);
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_device ON ezz_sessions (role, device_id);
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_user_id ON ezz_sessions(role, user_id);
CREATE INDEX IF NOT EXISTS idx_ezz_drivers_id ON ezz_drivers (id);

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

-- ============================================================
-- SECURITY DEFINER functions for driver admin operations
-- (bypasses RLS to avoid connection pooling issues)
-- SECURITY: requires valid admin session via verify_session
CREATE OR REPLACE FUNCTION admin_update_driver(
  p_admin_user_id TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_driver_id TEXT,
  p_data JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_session(p_admin_user_id, 'ADMIN', p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE ezz_drivers
  SET
    approval_status = COALESCE(p_data->>'approval_status', approval_status),
    is_online       = COALESCE((p_data->>'is_online')::BOOLEAN, is_online)
  WHERE id = p_driver_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_driver_approval(
  p_admin_user_id TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_driver_id TEXT,
  p_approval_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_session(p_admin_user_id, 'ADMIN', p_device_id) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE ezz_drivers
  SET approval_status = p_approval_status
  WHERE id = p_driver_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- Storage bucket setup:
-- ============================================================
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Create bucket named: driver-documents (PUBLIC)
-- 3. Add these policies in Storage -> Policies:
--
--    CREATE POLICY "anon_upload_driver_docs" ON storage.objects
--      FOR INSERT TO anon WITH CHECK (bucket_id = 'driver-documents');
--    CREATE POLICY "anon_read_driver_docs" ON storage.objects
--      FOR SELECT TO anon USING (bucket_id = 'driver-documents');
--    CREATE POLICY "anon_update_driver_docs" ON storage.objects
--      FOR UPDATE TO anon USING (bucket_id = 'driver-documents');
--    CREATE POLICY "anon_delete_driver_docs" ON storage.objects
--      FOR DELETE TO anon USING (bucket_id = 'driver-documents');
-- ============================================================
`;

// --- DRIVER TRANSFORMS ---
export const mapDriverFromDB = (row: any): Driver => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  password: row.password,
  carModel: row.car_model || '',
  carPlate: row.car_plate || '',
  vehicleType: (row.vehicle_type || 'CAR').toUpperCase(),
  vehicleName: row.vehicle_name || '',
  nationalId: row.national_id || '',
  driverLicense: row.driver_license || '',
  personalPhoto: row.personal_photo || '',
  nationalIdImage: row.national_id_image || '',
  driverLicenseImage: row.driver_license_image || '',
  vehicleLicenseImage: row.vehicle_license_image || '',
  isOnline: !!row.is_online,
  status: row.status || 'AVAILABLE',
  approvalStatus: row.approval_status || 'PENDING',
  rating: row.rating || 5.0,
  totalTrips: row.total_trips || 0,
  totalEarnings: row.total_earnings || 0,
  totalCommissionPaid: row.total_commission_paid || 0,
  currentX: row.current_x || 50,
  currentY: row.current_y || 50,
  agreedToTerms: !!row.agreed_to_terms,
  serviceAreas: (() => {
    const val = row.service_areas;
    if (Array.isArray(val)) return val;
    if (!val) return [];
    try {
      // sometimes stored as JSON string
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })(),
  autoAccept: !!row.auto_accept,
  autoShowMap: !!row.auto_show_map,
  lastSeen: row.last_seen || undefined,
  fcmToken: row.fcm_token || undefined,
});

export const mapDriverToDB = (drv: Driver) => ({
  id: drv.id,
  name: drv.name,
  phone: drv.phone,
  password: drv.password,
  car_model: drv.carModel,
  car_plate: drv.carPlate,
  vehicle_type: drv.vehicleType,
  vehicle_name: drv.vehicleName,
  national_id: drv.nationalId,
  driver_license: drv.driverLicense,
  personal_photo: drv.personalPhoto,
  national_id_image: drv.nationalIdImage,
  driver_license_image: drv.driverLicenseImage,
  vehicle_license_image: drv.vehicleLicenseImage,
  is_online: drv.isOnline,
  status: drv.status,
  approval_status: drv.approvalStatus,
  rating: drv.rating,
  total_trips: drv.totalTrips,
  total_earnings: drv.totalEarnings,
  total_commission_paid: drv.totalCommissionPaid,
  current_x: drv.currentX,
  current_y: drv.currentY,
  agreed_to_terms: drv.agreedToTerms,
  service_areas: drv.serviceAreas || [],
  auto_accept: drv.autoAccept || false,
  auto_show_map: drv.autoShowMap || false,
  last_seen: drv.lastSeen || new Date().toISOString(),
  fcm_token: drv.fcmToken || null,
});

// --- RIDER TRANSFORMS ---
export const mapRiderFromDB = (row: any): Rider => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  password: row.password,
  rating: row.rating || 5.0,
  totalTrips: row.total_trips || 0,
  approvalStatus: row.approval_status || 'APPROVED',
  preferences: (row.preferences as RiderPreferences) || {},
});

export const mapRiderToDB = (r: Rider) => {
  const base = {
    id: r.id,
    name: r.name,
    phone: r.phone,
    password: r.password,
    rating: r.rating || 5.0,
    total_trips: r.totalTrips || 0,
  } as any;
  if (r.approvalStatus && r.approvalStatus !== 'APPROVED') {
    base.approval_status = r.approvalStatus;
  }
  if (r.preferences) {
    base.preferences = r.preferences;
  }
  return base;
};

// --- LOCATION TRANSFORMS ---
export const mapLocationFromDB = (row: any): Location => ({
  id: row.id,
  nameAr: row.name_ar,
  nameEn: row.name_en,
  lat: row.lat,
  lng: row.lng,
  city: row.city || '',
  country: row.country || '',
  x: row.x || 50,
  y: row.y || 50,
});

export const mapLocationToDB = (loc: Location) => ({
  id: loc.id,
  name_ar: loc.nameAr,
  name_en: loc.nameEn,
  lat: loc.lat,
  lng: loc.lng,
  city: loc.city,
  country: loc.country,
  x: loc.x,
  y: loc.y,
});

// --- REGION TRANSFORMS ---
export const mapRegionFromDB = (row: any): Region => ({
  id: row.id,
  nameAr: row.name_ar,
  nameEn: row.name_en,
  country: row.country || '',
  lat: row.lat || 0,
  lng: row.lng || 0,
  pricing: row.pricing || undefined,
  createdAt: row.created_at || '',
});

export const mapRegionToDB = (region: Region) => {
  const normalized = ensureRegionPricing(region);
  return {
    id: normalized.id,
    name_ar: normalized.nameAr,
    name_en: normalized.nameEn,
    country: normalized.country,
    lat: normalized.lat,
    lng: normalized.lng,
    pricing: normalized.pricing || null,
    created_at: normalized.createdAt,
  };
};

// --- TRIP TRANSFORMS ---
export const mapTripFromDB = (row: any): Trip => ({
  id: row.id,
  riderId: row.rider_id || undefined,
  riderName: row.rider_name || '',
  riderPhone: row.rider_phone || '',
  driverId: row.driver_id || undefined,
  driverName: row.driver_name || undefined,
  pickup: row.pickup || { lat: 0, lng: 0, nameAr: '', nameEn: '' },
  dropoff: row.dropoff || { lat: 0, lng: 0, nameAr: '', nameEn: '' },
  pickupLandmark: row.pickup_landmark || undefined,
  status: row.status || 'IDLE',
  fare: row.fare || 0,
  commission: row.commission || 0,
  distance: row.distance || 0,
  etaMinutes: row.eta_minutes || undefined,
  requestedVehicleType: row.requested_vehicle_type || undefined,
  createdAt: row.created_at || '',
  completedAt: row.completed_at || undefined,
  chatMessages: Array.isArray(row.chat_messages)
    ? row.chat_messages.filter((msg: any) => msg && typeof msg.id === 'string')
    : [],
  riderRatingToDriver: row.rider_rating_to_driver || undefined,
  riderFeedbackTags: row.rider_feedback_tags || [],
  riderFeedbackComment: row.rider_feedback_comment || undefined,
  driverRatingToRider: row.driver_rating_to_rider || undefined,
  driverFeedbackTags: row.driver_feedback_tags || [],
  driverFeedbackComment: row.driver_feedback_comment || undefined,
  routeGeometry: row.route_geometry || undefined,
  offeredDriverIds: Array.isArray(row.offered_driver_ids)
    ? row.offered_driver_ids.filter((id: any) => typeof id === 'string')
    : undefined,
  currentOfferedDriverId: row.current_offered_driver_id || undefined,
  dispatchTimer: row.dispatch_timer ?? undefined,
  dispatchTimerMax: row.dispatch_timer_max ?? undefined,
  appliedPromoCode: row.applied_promo_code || undefined,
  appliedPromoDiscount: row.applied_promo_discount || undefined,
});

export const mapTripToDB = (trip: Trip) => ({
  id: trip.id,
  rider_id: trip.riderId,
  rider_name: trip.riderName,
  rider_phone: trip.riderPhone,
  driver_id: trip.driverId || null,
  driver_name: trip.driverName || null,
  pickup: trip.pickup,
  dropoff: trip.dropoff,
  pickup_landmark: trip.pickupLandmark || null,
  status: trip.status,
  fare: trip.fare,
  commission: trip.commission,
  distance: trip.distance,
  eta_minutes: trip.etaMinutes || null,
  requested_vehicle_type: trip.requestedVehicleType || null,
  created_at: trip.createdAt,
  completed_at: trip.completedAt || null,
  chat_messages: trip.chatMessages?.filter((msg) => msg && typeof msg.id === 'string') || [],
  rider_rating_to_driver: trip.riderRatingToDriver || null,
  rider_feedback_tags: trip.riderFeedbackTags || [],
  rider_feedback_comment: trip.riderFeedbackComment || null,
  driver_rating_to_rider: trip.driverRatingToRider || null,
  driver_feedback_tags: trip.driverFeedbackTags || [],
  driver_feedback_comment: trip.driverFeedbackComment || null,
  route_geometry: trip.routeGeometry || null,
  offered_driver_ids: trip.offeredDriverIds || null,
  current_offered_driver_id: trip.currentOfferedDriverId || null,
  dispatch_timer: trip.dispatchTimer ?? null,
  dispatch_timer_max: trip.dispatchTimerMax ?? null,
  applied_promo_code: trip.appliedPromoCode || null,
  applied_promo_discount: trip.appliedPromoDiscount || null,
});

// --- API METHODS ---

// Ultra-lightweight polling: only essential fields for map/display (approved drivers)
export const fetchDriversPolling = async (): Promise<Driver[] | null> => {
  try {
    const result = await withRetry<Driver[]>(() =>
      supabase
        .from('ezz_drivers')
        .select('id,name,status,is_online,approval_status,current_x,current_y,vehicle_type,vehicle_name,rating,total_trips,last_seen,service_areas')
        .eq('approval_status', 'APPROVED')
    );
    if (result.error) throw result.error;
    return (result.data || []).map(mapDriverFromDB);
  } catch (err: any) {
    console.warn('Could not fetch drivers (polling) from Supabase:', err.message);
    return null;
  }
};

// Lightweight driver fetch for dispatch (excludes heavy image columns)
export const fetchDriversBasic = async (): Promise<Driver[] | null> => {
  try {
    const result = await withRetry<Driver[]>(() =>
      supabase
        .from('ezz_drivers')
        .select('id,name,status,is_online,approval_status,current_x,current_y,vehicle_type,vehicle_name,rating,total_trips,last_seen,service_areas')
    );
    if (result.error) throw result.error;
    return (result.data || []).map(mapDriverFromDB);
  } catch (err: any) {
    console.warn('Could not fetch drivers (basic) from Supabase:', err.message);
    return null;
  }
};

// Fetch Drivers (full data - for admin/profile screens only)
export const fetchDrivers = async (): Promise<Driver[] | null> => {
  try {
    const result = await withRetry<Driver[]>(() =>
      supabase.from('ezz_drivers').select('id,name,phone,password,car_model,car_plate,vehicle_type,vehicle_name,national_id,driver_license,personal_photo,national_id_image,driver_license_image,vehicle_license_image,is_online,status,approval_status,rating,total_trips,total_earnings,total_commission_paid,current_x,current_y,agreed_to_terms,service_areas,last_seen,auto_accept,auto_show_map,fcm_token')
    );
    if (result.error) throw result.error;
    return (result.data || []).map(mapDriverFromDB);
  } catch (err: any) {
    console.warn('Could not fetch drivers from Supabase, using local:', err.message);
    return null;
  }
};

// Save Driver
export const saveDriver = async (driver: Driver): Promise<boolean> => {
  try {
    const driverData = { ...mapDriverToDB(driver) };
    if (driver.password && isSecureHash(driver.password)) {
      driverData.password = driver.password;
    } else if (driver.password && !isSecureHash(driver.password)) {
      driverData.password = await hashPassword(driver.password);
    } else {
      delete driverData.password;
    }
    console.log('[saveDriver] 1. Starting save process for:', driverData.id, 'approval:', driverData.approval_status, 'commission:', driverData.total_commission_paid);

    const attemptSave = async (): Promise<{ data: any; error: any }> => {
      return await supabase
        .from('ezz_drivers')
        .upsert(driverData, { onConflict: 'id' })
        .select();
    };

    let { data, error } = await attemptSave();

    if (error) {
      console.warn('[saveDriver] First attempt failed, retrying once...');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      ({ data, error } = await attemptSave());
    }

    const responseData = data as any[] | null;
    console.log('[saveDriver] 5. Upsert response:', { count: Array.isArray(responseData) ? responseData.length : 0, error: error?.message || null });

    if (error) {
      console.error('[saveDriver] 6. Supabase returned error:', error);
      return false;
    }
    console.log('[saveDriver] 6. Upsert completed successfully.');
    return true;
  } catch (err: any) {
    console.error('[saveDriver] Exception caught:', err.message || err);
    return false;
  }
};

// Delete Driver
export const deleteDriverInDB = async (driverId: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_drivers').delete().eq('id', driverId);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not delete driver in Supabase:', err.message);
    return false;
  }
};

// Fetch Registered Riders
export const fetchRiders = async (): Promise<Rider[] | null> => {
  try {
    const result = await withRetry<Rider[]>(() =>
      supabase.from('ezz_riders').select('id,name,phone,password,rating,total_trips,approval_status,preferences')
    );
    if (result.error) throw result.error;
    return (result.data || []).map(mapRiderFromDB);
  } catch (err: any) {
    console.warn('Could not fetch riders from Supabase:', err.message);
    return null;
  }
};

// Save Rider
export const saveRider = async (rider: Rider): Promise<boolean> => {
  try {
    const riderData = { ...mapRiderToDB(rider) };
    if (rider.password && isSecureHash(rider.password)) {
      riderData.password = rider.password;
    } else if (rider.password && !isSecureHash(rider.password)) {
      riderData.password = await hashPassword(rider.password);
    } else {
      delete riderData.password;
    }
    const result = await withRetry<boolean>(() =>
      supabase.from('ezz_riders').upsert(riderData)
    );
    if (result.error) throw result.error;
    return true;
  } catch (err: any) {
    console.warn('Could not save rider to Supabase:', err.message);
    return false;
  }
};

// Delete Rider
export const deleteRiderInDB = async (riderId: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_riders').delete().eq('id', riderId);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not delete rider in Supabase:', err.message);
    return false;
  }
};

// Fetch Active Trip
export const fetchActiveTrip = async (userId?: string, userRole?: 'rider' | 'driver' | 'admin'): Promise<Trip | null> => {
  try {
    // If no userId or userRole is provided (and not admin), NEVER return arbitrary trips from the DB
    if (!userId || !userRole) {
      return null;
    }

    let query = supabase.from('ezz_active_trip').select('*').order('created_at', { ascending: false });

    if (userRole === 'rider') {
      query = query.eq('rider_id', userId).in('status', ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']);
    } else if (userRole === 'driver') {
      query = query.or(`driver_id.eq.${userId},current_offered_driver_id.eq.${userId}`);
      query = query.in('status', ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']);
    } else if (userRole === 'admin') {
      query = query.in('status', ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']);
    }

    const isDriverQuery = userRole === 'driver';
    const result = await withRetry<any[]>(() => query.limit(isDriverQuery ? 5 : 1));
    const { data, error } = result;
    if (error) {
      if (error.code === 'PGRST116') {
        console.log('[fetchActiveTrip] No active trip in DB (empty table)');
        return null;
      }
      throw error;
    }
    if (!data || data.length === 0) {
      return null;
    }

    if (userRole === 'driver') {
      const relevant = data.find((row: any) => {
        const trip = mapTripFromDB(row);
        if (trip.driverId === userId) return true;
        if (trip.currentOfferedDriverId === userId) return true;
        if (trip.status === 'SEARCHING' && trip.offeredDriverIds?.includes(userId)) return true;
        return false;
      });
      if (relevant) {
        console.log('[fetchActiveTrip] Found active trip:', relevant.id, 'status:', relevant.status, 'for driver:', userId);
        return mapTripFromDB(relevant);
      }
      console.log('[fetchActiveTrip] No relevant trip for driver:', userId);
      return null;
    }

    if (userRole === 'rider') {
      const trip = mapTripFromDB(data[0]);
      if (trip.riderId === userId) {
        return trip;
      }
      return null;
    }

    return mapTripFromDB(data[0]);
  } catch (err: any) {
    console.warn('Could not fetch active trip from Supabase:', err.message);
    return null;
  }
};

// Fetch all active trips (for admin dashboard live tracking)
export const fetchAllActiveTrips = async (): Promise<Trip[]> => {
  try {
    const { data, error } = await supabase
      .from('ezz_active_trip')
      .select('*')
      .in('status', ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapTripFromDB);
  } catch (err: any) {
    console.warn('Could not fetch all active trips from Supabase:', err.message);
    return [];
  }
};

// Save Active Trip
export const saveActiveTrip = async (trip: Trip | null, clearTripId?: string): Promise<boolean> => {
  try {
    if (!trip) {
      if (!clearTripId) {
        console.warn('[saveActiveTrip] Refusing to clear active trip without trip id');
        return false;
      }
      const { error } = await supabase
        .from('ezz_active_trip')
        .delete()
        .eq('id', clearTripId);
      if (error) throw error;
      console.log('[saveActiveTrip] Cleared active trip from DB:', clearTripId);
      return true;
    }

    console.log('[saveActiveTrip] Saving trip to DB:', trip.id, 'status:', trip.status, 'offeredDriverIds:', trip.offeredDriverIds, 'chatMessages count:', trip.chatMessages?.length || 0);

    // If updating an existing trip with chat messages, merge with remote to avoid losing messages
    if (trip.id && trip.chatMessages && trip.chatMessages.length > 0) {
      const { data: existing, error: fetchError } = await supabase
        .from('ezz_active_trip')
        .select('chat_messages')
        .eq('id', trip.id)
        .maybeSingle();

      if (!fetchError && existing && existing.chat_messages) {
        const remoteMsgs = existing.chat_messages || [];
        const localMsgs = trip.chatMessages || [];
        const remoteMsgIds = new Set(remoteMsgs.map((m: any) => m.id));
        const merged = [...remoteMsgs];
        for (const m of localMsgs) {
          if (!remoteMsgIds.has(m.id)) {
            merged.push(m);
          }
        }
        const tripToSave = { ...trip, chatMessages: merged };
        const { error: insertError } = await supabase
          .from('ezz_active_trip')
          .upsert(mapTripToDB(tripToSave), { onConflict: 'id' });
        if (insertError) throw insertError;
        console.log('[saveActiveTrip] Trip saved successfully, chatMessages count after merge:', tripToSave.chatMessages?.length || 0);
        return true;
      }
    }

    // ── All statuses (including ACCEPTED) use upsert ────
    const tripData = mapTripToDB(trip) as any;
    if (!trip.chatMessages || trip.chatMessages.length === 0) {
      delete tripData.chat_messages;
    }
    const { error: insertError } = await supabase
      .from('ezz_active_trip')
      .upsert(tripData, { onConflict: 'id' });
    if (insertError) throw insertError;
    console.log('[saveActiveTrip] Trip saved successfully, chatMessages count after merge:', trip.chatMessages?.length || 0);

    return true;
  } catch (err: any) {
    console.warn('Could not save active trip to Supabase:', err.message);
    return false;
  }
};

/**
 * Atomic Trip Acceptance with Race Condition Lock.
 * Guarantees that if multiple drivers press Accept simultaneously:
 * - Only the first driver to atomically update the row wins.
 * - Any subsequent driver gets an immediate rejection status with zero hang/freeze.
 */
export interface AtomicAcceptResult {
  success: boolean;
  reason?: 'ALREADY_TAKEN' | 'CANCELLED' | 'ERROR';
  acceptedTrip?: Trip | null;
  winnerDriverName?: string;
}

export const atomicAcceptTrip = async (
  tripId: string,
  driverId: string,
  driverName: string
): Promise<AtomicAcceptResult> => {
  try {
    // Atomic update WHERE id = tripId AND status = 'SEARCHING'
    const { data: updatedRows, error: updateError } = await supabase
      .from('ezz_active_trip')
      .update({
        status: 'ACCEPTED',
        driver_id: driverId,
        driver_name: driverName,
      })
      .eq('id', tripId)
      .eq('status', 'SEARCHING')
      .select('*');

    if (updateError) {
      console.warn('[atomicAcceptTrip] Database error during atomic accept:', updateError.message);
      // Fallback: check if we were actually set as driver
      const { data: checkTrip } = await supabase
        .from('ezz_active_trip')
        .select('*')
        .eq('id', tripId)
        .maybeSingle();

      if (checkTrip && checkTrip.status === 'ACCEPTED' && checkTrip.driver_id === driverId) {
        return { success: true, acceptedTrip: mapTripFromDB(checkTrip) };
      }
      return { success: false, reason: 'ERROR' };
    }

    // Success: Exactly 1 row updated for this driver
    if (updatedRows && updatedRows.length > 0 && updatedRows[0].driver_id === driverId) {
      console.log('[atomicAcceptTrip] Race condition WON by driver:', driverId, 'for trip:', tripId);
      return { success: true, acceptedTrip: mapTripFromDB(updatedRows[0]) };
    }

    // 0 rows updated: Race condition LOST (another driver accepted or rider cancelled)
    console.log('[atomicAcceptTrip] Race condition: Another driver won or status is no longer SEARCHING for trip:', tripId);
    const { data: currentTrip } = await supabase
      .from('ezz_active_trip')
      .select('*')
      .eq('id', tripId)
      .maybeSingle();

    if (!currentTrip) {
      return { success: false, reason: 'CANCELLED' };
    }

    const mapped = mapTripFromDB(currentTrip);
    if (mapped.status === 'ACCEPTED') {
      if (mapped.driverId === driverId) {
        return { success: true, acceptedTrip: mapped };
      }
      return {
        success: false,
        reason: 'ALREADY_TAKEN',
        winnerDriverName: mapped.driverName || 'كابتن آخر',
        acceptedTrip: mapped,
      };
    }

    return {
      success: false,
      reason: mapped.status === 'CANCELLED' ? 'CANCELLED' : 'ALREADY_TAKEN',
      acceptedTrip: mapped,
    };
  } catch (err: any) {
    console.warn('[atomicAcceptTrip] Unexpected exception:', err?.message || err);
    return { success: false, reason: 'ERROR' };
  }
};

// Subscribe to active trip changes in realtime (used by driver and rider to sync trips and direct chat instantly)
export const subscribeToActiveTrips = (
  onTrip: (trip: Trip | null) => void,
  userId?: string,
  userRole?: 'rider' | 'driver' | 'admin'
): { unsubscribe: () => void } => {
  const channel = supabase
    .channel(`ezz_active_trip_changes_${userRole || 'all'}_${userId || 'global'}_${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ezz_active_trip' },
      (payload: any) => {
        if (payload.eventType === 'DELETE') {
          onTrip(null);
          return;
        }
        if (payload.new) {
          const trip = mapTripFromDB(payload.new);
          if (userRole === 'rider') {
            if (!userId || trip.riderId !== userId) return;
          } else if (userRole === 'driver') {
            if (!userId) return;
            const isAssignedDriver = trip.driverId === userId;
            const isCurrentOffered = trip.currentOfferedDriverId === userId;
            const isOffered = !!(trip.offeredDriverIds && trip.offeredDriverIds.includes(userId));
            if (!isAssignedDriver && !isCurrentOffered && !isOffered) return;
          } else if (userRole !== 'admin') {
            return;
          }
          onTrip(trip);
        }
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    }
  };
};

// Fetch Trips History
export const fetchTripsHistory = async ({ userId, role, deviceId }: { userId?: string; role?: 'rider' | 'driver'; deviceId?: string } = {}): Promise<Trip[] | null> => {
  try {
    if (!userId || !role) return null;
    const { data, error } = await supabase.rpc('get_my_trips', {
      p_user_id: userId,
      p_role: role,
      p_device_id: deviceId || null,
      p_page: 0,
      p_limit: 50,
      p_date_from: null,
      p_date_to: null,
      p_status_filter: 'all',
      p_search: null,
    });
    if (error) throw error;
    return (data || []).map(mapTripFromDB);
  } catch (err: any) {
    console.warn('Could not fetch trips history from Supabase:', err.message);
    return null;
  }
};

// Add to Trips History
export const saveTripToHistory = async (
  trip: Trip,
  userId?: string,
  role?: 'rider' | 'driver' | 'admin',
  deviceId?: string
): Promise<boolean> => {
  try {
    const payload = {
      p_user_id: userId || '',
      p_role: role || 'rider',
      p_device_id: deviceId || '',
      p_trip: mapTripToDB(trip),
    };
    console.log('[saveTripToHistory] Attempting to save trip:', trip.id, 'role:', role, 'userId:', userId, 'deviceId:', deviceId);
    const { error } = await supabase.rpc('save_trip_to_history', payload);
    if (error) {
      console.error('[saveTripToHistory] RPC error:', error);
      throw error;
    }
    console.log('[saveTripToHistory] Trip saved successfully:', trip.id);
    return true;
  } catch (err: any) {
    console.error('[saveTripToHistory] Failed to save trip:', err.message);
    return false;
  }
};

export const debugTripsHistory = async (): Promise<{
  rpcExists: boolean;
  sessionCount: number;
  tripsCount: number;
  sampleSession: any;
  error?: string;
}> => {
  try {
    const [rpcCheck, sessionCheck, tripsCheck] = await Promise.all([
      supabase.from('pg_proc').select('proname').eq('proname', 'save_trip_to_history').maybeSingle(),
      supabase.from('ezz_sessions').select('*').limit(1).maybeSingle(),
      supabase.from('ezz_trips_history').select('*', { count: 'exact', head: true }),
    ]);

    return {
      rpcExists: !!rpcCheck.data,
      sessionCount: sessionCheck.data ? 1 : 0,
      tripsCount: tripsCheck.count || 0,
      sampleSession: sessionCheck.data || null,
      error: rpcCheck.error?.message || sessionCheck.error?.message || tripsCheck.error?.message,
    };
  } catch (err: any) {
    return {
      rpcExists: false,
      sessionCount: 0,
      tripsCount: 0,
      sampleSession: null,
      error: err.message,
    };
  }
};

export const fetchTripsHistoryCount = async ({
  userId,
  role,
  deviceId,
  dateFrom,
  dateTo,
}: {
  userId?: string;
  role?: 'rider' | 'driver';
  deviceId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<number> => {
  try {
    if (!userId || !role) return 0;
    const { data, error } = await supabase.rpc('count_my_trips', {
      p_user_id: userId,
      p_role: role,
      p_device_id: deviceId || null,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_status_filter: 'all',
      p_search: null,
    });
    if (error) throw error;
    return Number(data) || 0;
  } catch (err: any) {
    console.warn('Could not count trips history from Supabase:', err.message);
    return 0;
  }
};

export const fetchAdminTripsCount = async (adminUserId?: string, deviceId?: string): Promise<number> => {
  try {
    const { data, error } = await supabase.rpc('count_admin_trips', {
      p_admin_user_id: adminUserId || '',
      p_device_id: deviceId || '',
      p_date_from: null,
      p_date_to: null,
      p_status_filter: 'all',
      p_search: null,
    });
    if (error) throw error;
    return Number(data) || 0;
  } catch (err: any) {
    console.warn('Could not count admin trips from Supabase:', err.message);
    return 0;
  }
};

export const fetchTripsHistoryPaginated = async ({
  userId,
  role,
  deviceId,
  dateFrom,
  dateTo,
  statusFilter,
  searchQuery,
  page = 0,
  limit = PAGE_SIZE,
}: {
  userId?: string;
  role?: 'rider' | 'driver';
  deviceId?: string;
  dateFrom?: string;
  dateTo?: string;
  statusFilter?: string;
  searchQuery?: string;
  page?: number;
  limit?: number;
}): Promise<{ trips: Trip[]; hasMore: boolean }> => {
  try {
    if (!userId || !role) {
      return { trips: [], hasMore: false };
    }
    const { data, error } = await supabase.rpc('get_my_trips', {
      p_user_id: userId,
      p_role: role,
      p_device_id: deviceId || null,
      p_page: page,
      p_limit: limit,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_status_filter: statusFilter || 'all',
      p_search: searchQuery || null,
    });
    if (error) throw error;

    const trips = (data || []).map(mapTripFromDB);
    return { trips, hasMore: trips.length === limit };
  } catch (err: any) {
    console.warn('Could not fetch paginated trips history from Supabase:', err.message);
    return { trips: [], hasMore: false };
  }
};

export const fetchTripsHistoryFilteredPaginated = async ({
  userId,
  role,
  deviceId,
  dateFrom,
  dateTo,
  statusFilter,
  searchQuery,
  page = 0,
  limit = PAGE_SIZE,
}: {
  userId?: string;
  role?: 'rider' | 'driver' | 'admin';
  deviceId?: string;
  dateFrom?: string;
  dateTo?: string;
  statusFilter?: string;
  searchQuery?: string;
  page?: number;
  limit?: number;
}): Promise<{ trips: Trip[]; hasMore: boolean }> => {
  try {
    const adminId = role === 'admin' ? userId : undefined;
    const { data, error } = await supabase.rpc('get_admin_trips', {
      p_admin_user_id: adminId || userId,
      p_device_id: deviceId || null,
      p_page: page,
      p_limit: limit,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_status_filter: statusFilter || 'all',
      p_search: searchQuery || null,
    });
    if (error) throw error;

    const trips = (data || []).map(mapTripFromDB);
    return { trips, hasMore: trips.length === limit };
  } catch (err: any) {
    console.warn('Could not fetch filtered paginated trips history from Supabase:', err.message);
    return { trips: [], hasMore: false };
  }
};

// Fetch all trips (admin/backup usage)
export const fetchAllTrips = async (limit: number = 1000, adminUserId?: string, deviceId?: string): Promise<Trip[]> => {
  try {
    const { data, error } = await supabase.rpc('get_admin_trips', {
      p_admin_user_id: adminUserId || '',
      p_device_id: deviceId || null,
      p_page: 0,
      p_limit: limit,
      p_date_from: null,
      p_date_to: null,
      p_status_filter: 'all',
      p_search: null,
    });
    if (error) throw error;
    return (data || []).map(mapTripFromDB);
  } catch (err: any) {
    console.warn('Could not fetch all trips from Supabase:', err.message);
    return [];
  }
};

// Clear Trips History (admin only - uses secure RPC)
export const clearTripsHistoryInDB = async (adminUserId?: string, deviceId?: string): Promise<boolean> => {
  try {
    const { error } = await supabase.rpc('admin_clear_all_trips', {
      p_admin_user_id: adminUserId || '',
      p_device_id: deviceId || '',
    });
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not clear trips history in Supabase:', err.message);
    return false;
  }
};

// Clear ALL Riders from Supabase
export const clearAllRidersInDB = async (): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_riders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not clear riders in Supabase:', err.message);
    return false;
  }
};

// Clear ALL Drivers from Supabase
export const clearAllDriversInDB = async (): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_drivers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not clear drivers in Supabase:', err.message);
    return false;
  }
};

// Fetch Stats
const REGION_PRICING_REQUIRED_FIELDS = [
  'distanceBuffer',
  'additionalKm',
  'carBaseFare',
  'carMinFare',
  'carPricePerKm0to20',
  'carPricePerKm20to50',
  'carPricePerKm50plus',
  'motorcycleBaseFare',
  'motorcycleMinFare',
  'motorcyclePricePerKm0to20',
  'motorcyclePricePerKm20to50',
  'motorcyclePricePerKm50plus',
  'toktokBaseFare',
  'toktokMinFare',
  'toktokPricePerKm0to20',
  'toktokPricePerKm20to50',
  'toktokPricePerKm50plus',
  'tricycleBaseFare',
  'tricycleMinFare',
  'tricyclePricePerKm0to20',
  'tricyclePricePerKm20to50',
  'tricyclePricePerKm50plus',
  'commissionMode',
  'incomingCommission',
  'outgoingCommission',
  'incomingCommissionPercent',
  'outgoingCommissionPercent',
] as const;

const DEFAULT_REGION_PRICING: RegionPricing = {
  distanceBuffer: 1.25,
  additionalKm: 0.0,
  carBaseFare: 20,
  carMinFare: 2,
  carPricePerKm0to20: 8,
  carPricePerKm20to50: 8,
  carPricePerKm50plus: 8,
  motorcycleBaseFare: 12,
  motorcycleMinFare: 2,
  motorcyclePricePerKm0to20: 5,
  motorcyclePricePerKm20to50: 5,
  motorcyclePricePerKm50plus: 5,
  toktokBaseFare: 10,
  toktokMinFare: 2,
  toktokPricePerKm0to20: 4,
  toktokPricePerKm20to50: 4,
  toktokPricePerKm50plus: 4,
  tricycleBaseFare: 10,
  tricycleMinFare: 2,
  tricyclePricePerKm0to20: 4,
  tricyclePricePerKm20to50: 4,
  tricyclePricePerKm50plus: 4,
  commissionMode: 'fixed',
  incomingCommission: 5,
  outgoingCommission: 5,
  incomingCommissionPercent: 10,
  outgoingCommissionPercent: 10,
};

export const ensureRegionPricing = (region: Region, stats?: SystemStats | null): Region => {
  const source = stats || (typeof window !== 'undefined' ? (() => {
    try {
      const raw = localStorage.getItem('ezz_system_stats');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })() : null);
  const base = { ...DEFAULT_REGION_PRICING, ...(source || {}) };
  const current = (region.pricing || {}) as RegionPricing;
  const pricing: RegionPricing = { ...base, ...current };
  return {
    ...region,
    pricing,
  };
};

export const validateRegionPricing = (pricing: any): boolean => {
  if (!pricing || typeof pricing !== 'object') return false;
  for (const field of REGION_PRICING_REQUIRED_FIELDS) {
    const value = pricing[field];
    if (value === undefined || value === null || value === '') {
      return false;
    }
  }
  return true;
};

export const fetchStats = async (): Promise<SystemStats | null> => {
  // Check local cache first
  let cachedStats: Partial<SystemStats> | null = null;
  try {
    const raw = localStorage.getItem('ezz_system_stats');
    if (raw) cachedStats = JSON.parse(raw);
  } catch {}

  try {
    const result = await withRetry<any[]>(() =>
      supabase.from('ezz_stats').select('*').eq('id', 'singleton')
    );
    if (result.error) throw result.error;
    if (!result.data || result.data.length === 0) {
      return cachedStats as SystemStats || null;
    }
    const row = result.data[0];
    const remote: SystemStats = {
      commissionRate: row.commission_rate ?? cachedStats?.commissionRate ?? 15,
      totalRevenue: row.total_revenue || 0,
      totalCommission: row.total_commission || 0,
      totalCompletedTrips: row.total_completed_trips || 0,
      fixedCommission: row.fixed_commission !== undefined && row.fixed_commission !== null ? row.fixed_commission : (cachedStats?.fixedCommission ?? 10),
      pricePerKm: row.price_per_km !== undefined && row.price_per_km !== null ? row.price_per_km : (cachedStats?.pricePerKm ?? 8),
      baseFare: row.base_fare !== undefined && row.base_fare !== null ? row.base_fare : (cachedStats?.baseFare ?? 20),
      distanceBuffer: row.distance_buffer !== undefined && row.distance_buffer !== null ? row.distance_buffer : (cachedStats?.distanceBuffer ?? 1.25),
      additionalKm: row.additional_km !== undefined && row.additional_km !== null ? row.additional_km : (cachedStats?.additionalKm ?? 0.0),
      internalCommission: row.internal_commission !== undefined && row.internal_commission !== null ? row.internal_commission : (cachedStats?.internalCommission ?? 10),
      externalCommission: row.external_commission !== undefined && row.external_commission !== null ? row.external_commission : (cachedStats?.externalCommission ?? 15),
      supportWhatsApp: row.support_whatsapp || cachedStats?.supportWhatsApp || '201015555555',
      shortTripCommission: row.short_trip_commission !== undefined && row.short_trip_commission !== null ? row.short_trip_commission : (cachedStats?.shortTripCommission ?? 10),
      longTripCommission: row.long_trip_commission !== undefined && row.long_trip_commission !== null ? row.long_trip_commission : (cachedStats?.longTripCommission ?? 15),
      freeKmThreshold: row.free_km_threshold !== undefined && row.free_km_threshold !== null ? row.free_km_threshold : (cachedStats?.freeKmThreshold ?? 2),
      carBaseFare: row.car_base_fare !== undefined && row.car_base_fare !== null ? row.car_base_fare : (cachedStats?.carBaseFare ?? 20),
      carPricePerKm: row.car_price_per_km !== undefined && row.car_price_per_km !== null ? row.car_price_per_km : (cachedStats?.carPricePerKm ?? 8),
      carMinFare: row.car_min_fare !== undefined && row.car_min_fare !== null ? row.car_min_fare : (cachedStats?.carMinFare ?? 2),
      carPricePerKm20to50: row.car_price_per_km_20to50 !== undefined && row.car_price_per_km_20to50 !== null ? row.car_price_per_km_20to50 : (cachedStats?.carPricePerKm20to50 ?? row.car_price_per_km ?? 8),
      carPricePerKm50plus: row.car_price_per_km_50plus !== undefined && row.car_price_per_km_50plus !== null ? row.car_price_per_km_50plus : (cachedStats?.carPricePerKm50plus ?? row.car_price_per_km ?? 8),
      motorcycleBaseFare: row.motorcycle_base_fare !== undefined && row.motorcycle_base_fare !== null ? row.motorcycle_base_fare : (cachedStats?.motorcycleBaseFare ?? 12),
      motorcyclePricePerKm: row.motorcycle_price_per_km !== undefined && row.motorcycle_price_per_km !== null ? row.motorcycle_price_per_km : (cachedStats?.motorcyclePricePerKm ?? 5),
      motorcycleMinFare: row.motorcycle_min_fare !== undefined && row.motorcycle_min_fare !== null ? row.motorcycle_min_fare : (cachedStats?.motorcycleMinFare ?? 2),
      motorcyclePricePerKm20to50: row.motorcycle_price_per_km_20to50 !== undefined && row.motorcycle_price_per_km_20to50 !== null ? row.motorcycle_price_per_km_20to50 : (cachedStats?.motorcyclePricePerKm20to50 ?? row.motorcycle_price_per_km ?? 5),
      motorcyclePricePerKm50plus: row.motorcycle_price_per_km_50plus !== undefined && row.motorcycle_price_per_km_50plus !== null ? row.motorcycle_price_per_km_50plus : (cachedStats?.motorcyclePricePerKm50plus ?? row.motorcycle_price_per_km ?? 5),
      toktokBaseFare: row.toktok_base_fare !== undefined && row.toktok_base_fare !== null ? row.toktok_base_fare : (cachedStats?.toktokBaseFare ?? 10),
      toktokPricePerKm: row.toktok_price_per_km !== undefined && row.toktok_price_per_km !== null ? row.toktok_price_per_km : (cachedStats?.toktokPricePerKm ?? 4),
      toktokMinFare: row.toktok_min_fare !== undefined && row.toktok_min_fare !== null ? row.toktok_min_fare : (cachedStats?.toktokMinFare ?? 2),
      toktokPricePerKm20to50: row.toktok_price_per_km_20to50 !== undefined && row.toktok_price_per_km_20to50 !== null ? row.toktok_price_per_km_20to50 : (cachedStats?.toktokPricePerKm20to50 ?? row.toktok_price_per_km ?? 4),
      toktokPricePerKm50plus: row.toktok_price_per_km_50plus !== undefined && row.toktok_price_per_km_50plus !== null ? row.toktok_price_per_km_50plus : (cachedStats?.toktokPricePerKm50plus ?? row.toktok_price_per_km ?? 4),
      tricycleBaseFare: row.tricycle_base_fare !== undefined && row.tricycle_base_fare !== null ? row.tricycle_base_fare : (cachedStats?.tricycleBaseFare ?? 10),
      tricyclePricePerKm: row.tricycle_price_per_km !== undefined && row.tricycle_price_per_km !== null ? row.tricycle_price_per_km : (cachedStats?.tricyclePricePerKm ?? 4),
      tricycleMinFare: row.tricycle_min_fare !== undefined && row.tricycle_min_fare !== null ? row.tricycle_min_fare : (cachedStats?.tricycleMinFare ?? 2),
      tricyclePricePerKm20to50: row.tricycle_price_per_km_20to50 !== undefined && row.tricycle_price_per_km_20to50 !== null ? row.tricycle_price_per_km_20to50 : (cachedStats?.tricyclePricePerKm20to50 ?? row.tricycle_price_per_km ?? 4),
      tricyclePricePerKm50plus: row.tricycle_price_per_km_50plus !== undefined && row.tricycle_price_per_km_50plus !== null ? row.tricycle_price_per_km_50plus : (cachedStats?.tricyclePricePerKm50plus ?? row.tricycle_price_per_km ?? 4),
      incomingCommission: row.incoming_commission !== undefined && row.incoming_commission !== null ? row.incoming_commission : (cachedStats?.incomingCommission ?? 5),
      outgoingCommission: row.outgoing_commission !== undefined && row.outgoing_commission !== null ? row.outgoing_commission : (cachedStats?.outgoingCommission ?? 5),
      incomingCommissionPercent: row.incoming_commission_percent !== undefined && row.incoming_commission_percent !== null ? row.incoming_commission_percent : (cachedStats?.incomingCommissionPercent ?? 10),
      outgoingCommissionPercent: row.outgoing_commission_percent !== undefined && row.outgoing_commission_percent !== null ? row.outgoing_commission_percent : (cachedStats?.outgoingCommissionPercent ?? 10),
      commissionMode: row.commission_mode || cachedStats?.commissionMode || 'fixed',
      promoCode: row.promo_code || cachedStats?.promoCode || 'EZZ5',
      promoValue: row.promo_value !== undefined && row.promo_value !== null ? row.promo_value : (cachedStats?.promoValue ?? 5),
      lowDataMode: row.low_data_mode !== undefined && row.low_data_mode !== null ? !!(row.low_data_mode) : (cachedStats?.lowDataMode ?? true),
      mapProvider: cachedStats?.mapProvider || 'leaflet',
      googleMapsApiKey: cachedStats?.googleMapsApiKey || '',
    };
    try {
      localStorage.setItem('ezz_system_stats', JSON.stringify(remote));
    } catch {}
    return remote;
  } catch (err: any) {
    console.warn('Could not fetch stats from Supabase:', err.message);
    return cachedStats as SystemStats || null;
  }
};

// Save Stats
export const saveStats = async (stats: SystemStats): Promise<boolean> => {
  // 1. Always cache immediately to LocalStorage so admin changes never get lost
  try {
    localStorage.setItem('ezz_system_stats', JSON.stringify(stats));
  } catch {}

  try {
    const payload: any = {
      id: 'singleton',
      commission_rate: stats.commissionRate,
      total_revenue: stats.totalRevenue,
      total_commission: stats.totalCommission,
      total_completed_trips: stats.totalCompletedTrips,
      fixed_commission: stats.fixedCommission,
      price_per_km: stats.carPricePerKm || stats.pricePerKm || 8,
      base_fare: stats.carBaseFare || stats.baseFare || 20,
      distance_buffer: stats.distanceBuffer,
      additional_km: stats.additionalKm,
      internal_commission: stats.internalCommission,
      external_commission: stats.externalCommission,
      support_whatsapp: stats.supportWhatsApp,
      free_km_threshold: stats.freeKmThreshold,
      short_trip_commission: stats.shortTripCommission,
      long_trip_commission: stats.longTripCommission,
      car_base_fare: stats.carBaseFare,
      car_price_per_km: stats.carPricePerKm,
      car_min_fare: stats.carMinFare,
      car_price_per_km_20to50: stats.carPricePerKm20to50,
      car_price_per_km_50plus: stats.carPricePerKm50plus,
      motorcycle_base_fare: stats.motorcycleBaseFare,
      motorcycle_price_per_km: stats.motorcyclePricePerKm,
      motorcycle_min_fare: stats.motorcycleMinFare,
      motorcycle_price_per_km_20to50: stats.motorcyclePricePerKm20to50,
      motorcycle_price_per_km_50plus: stats.motorcyclePricePerKm50plus,
      toktok_base_fare: stats.toktokBaseFare,
      toktok_price_per_km: stats.toktokPricePerKm,
      toktok_min_fare: stats.toktokMinFare,
      toktok_price_per_km_20to50: stats.toktokPricePerKm20to50,
      toktok_price_per_km_50plus: stats.toktokPricePerKm50plus,
      tricycle_base_fare: stats.tricycleBaseFare,
      tricycle_price_per_km: stats.tricyclePricePerKm,
      tricycle_min_fare: stats.tricycleMinFare,
      tricycle_price_per_km_20to50: stats.tricyclePricePerKm20to50,
      tricycle_price_per_km_50plus: stats.tricyclePricePerKm50plus,
      incoming_commission: stats.incomingCommission,
      outgoing_commission: stats.outgoingCommission,
      incoming_commission_percent: stats.incomingCommissionPercent,
      outgoing_commission_percent: stats.outgoingCommissionPercent,
      commission_mode: stats.commissionMode,
      promo_code: stats.promoCode,
      promo_value: stats.promoValue,
      low_data_mode: stats.lowDataMode,
    };

    const { error } = await supabase.from('ezz_stats').upsert(payload);
    if (error) {
      console.warn('Full stats upsert failed, retrying with core columns fallback:', error.message);
      // Fallback if some newer columns don't exist in user database table yet
      const corePayload: any = {
        id: 'singleton',
        commission_rate: stats.commissionRate,
        total_revenue: stats.totalRevenue,
        total_commission: stats.totalCommission,
        total_completed_trips: stats.totalCompletedTrips,
        fixed_commission: stats.fixedCommission,
        price_per_km: stats.carPricePerKm || stats.pricePerKm || 8,
        base_fare: stats.carBaseFare || stats.baseFare || 20,
        distance_buffer: stats.distanceBuffer,
        additional_km: stats.additionalKm,
        support_whatsapp: stats.supportWhatsApp,
        car_base_fare: stats.carBaseFare,
        car_price_per_km: stats.carPricePerKm,
        motorcycle_base_fare: stats.motorcycleBaseFare,
        motorcycle_price_per_km: stats.motorcyclePricePerKm,
        toktok_base_fare: stats.toktokBaseFare,
        toktok_price_per_km: stats.toktokPricePerKm,
        tricycle_base_fare: stats.tricycleBaseFare,
        tricycle_price_per_km: stats.tricyclePricePerKm,
      };
      const fallbackResult = await supabase.from('ezz_stats').upsert(corePayload);
      if (fallbackResult.error) {
        throw fallbackResult.error;
      }
    }
    return true;
  } catch (err: any) {
    console.warn('Could not save stats to Supabase:', err?.message || err);
    return false;
  }
};

const mapPromoCodeFromDB = (row: any): PromoCode => ({
  id: row.id,
  code: row.code,
  discountAmount: row.discount_amount || 0,
  riderId: row.rider_id || undefined,
  tripId: row.trip_id || undefined,
  used: row.used || false,
  usedAt: row.used_at || undefined,
  createdAt: row.created_at,
  expiresAt: row.expires_at || undefined,
  usageLimit: row.usage_limit ?? undefined,
  usageCount: row.usage_count || 0,
});

export const generatePromoCode = async (discountAmount: number, riderId?: string, expiresAt?: string, usageLimit?: number | null): Promise<PromoCode | null> => {
  try {
    const code = `EZZ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const id = `promo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const insertData: any = {
      id,
      code,
      discount_amount: discountAmount,
      rider_id: riderId || null,
      expires_at: expiresAt || null,
      used: false,
      usage_count: 0,
      created_at: new Date().toISOString(),
    };

    if (usageLimit !== undefined && usageLimit !== null && usageLimit > 0) {
      insertData.usage_limit = usageLimit;
    }

    const { data, error } = await supabase
      .from('ezz_promo_codes')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return mapPromoCodeFromDB(data);
  } catch (err) {
    console.warn('Could not generate promo code:', err);
    return null;
  }
};

export const validatePromoCode = async (code: string, riderId?: string): Promise<PromoCode | null> => {
  try {
    const { data, error } = await supabase
      .from('ezz_promo_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('used', false)
      .single();

    if (error || !data) return null;

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return null;
    }

    if (data.usage_limit !== null && data.usage_limit !== undefined && (data.usage_count || 0) >= data.usage_limit) {
      return null;
    }

    if (data.rider_id && data.rider_id !== riderId) {
      return null;
    }

    return mapPromoCodeFromDB(data);
  } catch (err) {
    console.warn('Could not validate promo code:', err);
    return null;
  }
};

export const markPromoCodeAsUsed = async (promoCodeId: string, tripId: string): Promise<boolean> => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('ezz_promo_codes')
      .select('usage_limit, usage_count, used')
      .eq('id', promoCodeId)
      .single();

    if (fetchError || !existing || existing.used) return false;

    const newCount = (existing.usage_count || 0) + 1;
    const shouldMarkUsed = existing.usage_limit !== null && existing.usage_limit !== undefined && newCount >= existing.usage_limit;

    const { error } = await supabase
      .from('ezz_promo_codes')
      .update({
        usage_count: newCount,
        used: shouldMarkUsed,
        trip_id: tripId,
        used_at: new Date().toISOString(),
      })
      .eq('id', promoCodeId)
      .eq('used', false);

    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('Could not mark promo code as used:', err);
    return false;
  }
};

export const deletePromoCode = async (promoCodeId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('ezz_promo_codes')
      .delete()
      .eq('id', promoCodeId);

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not delete promo code:', err.message);
    return false;
  }
};

export const fetchPromoCodes = async (): Promise<PromoCode[]> => {
  try {
    const { data, error } = await supabase
      .from('ezz_promo_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapPromoCodeFromDB);
  } catch (err) {
    console.warn('Could not fetch promo codes:', err);
    return [];
  }
};

// Fetch Locations
export const fetchLocations = async (): Promise<Location[] | null> => {
  try {
    const { data, error } = await supabase.from('ezz_locations').select('*');
    if (error) throw error;
    return data.map(mapLocationFromDB);
  } catch (err: any) {
    console.warn('Could not fetch locations from Supabase:', err.message);
    return null;
  }
};

// Save Location
export const saveLocationInDB = async (loc: Location): Promise<boolean> => {
  try {
    const result = await withRetry<boolean>(() =>
      supabase.from('ezz_locations').upsert(mapLocationToDB(loc))
    );
    if (result.error) throw result.error;
    return true;
  } catch (err: any) {
    console.warn('Could not save location to Supabase:', err.message);
    return false;
  }
};

// Delete Location
export const deleteLocationInDB = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_locations').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not delete location in Supabase:', err.message);
    return false;
  }
};

// --- REGIONS CRUD ---

export const fetchRegions = async (): Promise<Region[] | null> => {
  try {
    const { data, error } = await supabase.from('ezz_regions').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    const remote = (data || []).map(mapRegionFromDB);
    try {
      localStorage.setItem('ezz_regions_cache', JSON.stringify(remote));
    } catch {}
    return remote;
  } catch (err: any) {
    console.warn('Could not fetch regions from Supabase:', err.message);
    const raw = localStorage.getItem('ezz_regions_cache');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return null;
  }
};

export const saveRegion = async (region: Region): Promise<boolean> => {
  const normalized = ensureRegionPricing(region);
  const payload = mapRegionToDB(normalized);
  try {
    const raw = localStorage.getItem('ezz_regions_cache');
    let list: Region[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    const index = list.findIndex(r => r.id === normalized.id);
    if (index >= 0) {
      list[index] = normalized;
    } else {
      list.push(normalized);
    }
    localStorage.setItem('ezz_regions_cache', JSON.stringify(list));
  } catch {}

  try {
    const { error } = await supabase.from('ezz_regions').upsert(payload);
    if (error) throw error;
    return true;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn('[saveRegion] Could not save region to Supabase:', msg);
    return false;
  }
};

export const deleteRegionInDB = async (regionId: string): Promise<boolean> => {
  try {
    const raw = localStorage.getItem('ezz_regions_cache');
    if (raw) {
      let list: Region[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        list = list.filter(r => r.id !== regionId);
        localStorage.setItem('ezz_regions_cache', JSON.stringify(list));
      }
    }
  } catch {}

  try {
    const { error } = await supabase.from('ezz_regions').delete().eq('id', regionId);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not delete region in Supabase:', err.message);
    return false;
  }
};

// Save Rider Preferences (favorites / home / work / recent / last pickup-dropoff)
export const saveRiderPreferences = async (riderId: string, preferences: RiderPreferences): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_riders').update({ preferences }).eq('id', riderId);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not save rider preferences to Supabase:', err.message);
    return false;
  }
};

// --- AUDIT LOGS ---

export const logAuditToDB = async (entry: AuditLogEntry): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_audit_logs').insert({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      user_id: entry.userId,
      user_type: entry.userType,
      details: entry.details,
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent || null,
      success: entry.success,
      error_message: entry.errorMessage || null,
    });
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not save audit log to Supabase:', err.message);
    return false;
  }
};

// --- SESSIONS (keep user logged in across reloads & support multi-account tabs) ---

export const getDeviceId = (): string => {
  try {
    let deviceId = sessionStorage.getItem('ezz_tab_device_id');
    if (!deviceId) {
      const sharedDeviceId = localStorage.getItem('ezz_device_id');
      if (sharedDeviceId) {
        deviceId = sharedDeviceId;
      } else {
        deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        localStorage.setItem('ezz_device_id', deviceId);
      }
      sessionStorage.setItem('ezz_tab_device_id', deviceId);
    }
    return deviceId;
  } catch {
    return `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
};

export const saveSession = async (role: 'RIDER' | 'DRIVER' | 'ADMIN', userId: string): Promise<boolean> => {
  try {
    const deviceId = `tab_${role.toLowerCase()}_${userId}_${Math.random().toString(36).substring(2, 6)}`;
    try {
      sessionStorage.setItem('ezz_tab_device_id', deviceId);
      localStorage.setItem('ezz_device_id', deviceId);
    } catch {}

  const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const { error } = await supabase.from('ezz_sessions').insert({
    id,
    role,
    user_id: userId,
    device_id: deviceId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  localStorage.setItem(`ezz_session_${role.toLowerCase()}`, JSON.stringify({ userId, deviceId, updatedAt: new Date().toISOString() }));
  return true;
  } catch (err: any) {
    console.warn('Could not save session to Supabase:', err.message);
    return false;
  }
};

export const loadSession = async (): Promise<{ role: 'RIDER' | 'DRIVER' | 'ADMIN'; userId: string } | null> => {
  try {
    const deviceId = getDeviceId();
    const { data, error } = await supabase
      .from('ezz_sessions')
      .select('role,user_id,updated_at')
      .eq('device_id', deviceId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return { role: data[0].role as any, userId: data[0].user_id };
  } catch (err: any) {
    console.warn('Could not load session from Supabase:', err.message);
    return null;
  }
};

export const clearSession = async (role: 'RIDER' | 'DRIVER' | 'ADMIN'): Promise<boolean> => {
  try {
    const deviceId = getDeviceId();
    try {
      sessionStorage.removeItem('ezz_tab_device_id');
    } catch {}
    try {
      localStorage.removeItem('ezz_device_id');
      localStorage.removeItem('ezz_current_screen');
      localStorage.removeItem('ezz_rider_session');
      localStorage.removeItem('ezz_selected_driver_id');
      localStorage.removeItem('ezz_active_trip_cache');
      localStorage.removeItem('ezz_driver_logged_in');
      localStorage.removeItem(`ezz_session_${role.toLowerCase()}`);
      localStorage.removeItem('ezz_session_rider');
      localStorage.removeItem('ezz_session_driver');
      localStorage.removeItem('ezz_session_admin');
    } catch {}
    const { error } = await supabase.from('ezz_sessions').delete().eq('role', role).eq('device_id', deviceId);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('Could not clear session from Supabase:', err.message);
    return false;
  }
};

export const setAppRole = async (role: 'RIDER' | 'DRIVER' | 'ADMIN' | 'ANON'): Promise<void> => {
  try {
    await supabase.rpc('set_app_role', { role });
  } catch (err: any) {
    console.warn('Could not set app role:', err.message);
  }
};

// --- ADMIN AUTH ---

export const fetchAdmins = async (): Promise<Admin[] | null> => {
  try {
    const { data, error } = await supabase.from('ezz_admin').select('*');
    if (error) throw error;
    return data as Admin[];
  } catch (err: any) {
    console.warn('Could not fetch admins from Supabase:', err.message);
    return null;
  }
};

export const authenticateAdmin = async (phone: string, password: string): Promise<Admin | null> => {
  try {
    const { data, error } = await supabase.from('ezz_admin').select('*').eq('phone', phone).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;

    const admin = data[0] as Admin;
    const storedPassword = admin.password;

    if (!storedPassword) return null;

    if (isSecureHash(storedPassword)) {
      const isValid = await verifyPassword(password, storedPassword);
      return isValid ? admin : null;
    }

    return null;
  } catch (err: any) {
    console.warn('Could not authenticate admin:', err.message);
    return null;
  }
};

// ============================================================
// ADS — local store advertising
// ============================================================

const DEFAULT_LOCAL_ADS: Ad[] = [];

const mapAdRow = (row: any): Ad => ({
  id: row.id,
  storeName: row.store_name,
  offerText: row.offer_text,
  imageUrl: row.image_url,
  phoneNumber: row.phone_number,
  whatsapp: row.whatsapp ?? undefined,
  placement: row.placement ?? 'all',
  priority: row.priority ?? 1,
  isActive: row.is_active ?? true,
  startDate: row.start_date ?? undefined,
  endDate: row.end_date ?? undefined,
  clicks: row.clicks ?? 0,
  whatsappClicks: row.whatsapp_clicks ?? row.whatsappClicks ?? 0,
  adFee: row.ad_fee ?? row.adFee ?? 0,
  dailyImpressionLimit: row.daily_impression_limit ?? row.dailyImpressionLimit ?? 0,
  impressions: row.impressions ?? 0,
  regionId: row.region_id ?? undefined,
  createdAt: row.created_at ?? new Date().toISOString(),
});

const adToRow = (ad: Partial<Ad>) => ({
  store_name: ad.storeName,
  offer_text: ad.offerText,
  image_url: ad.imageUrl || null,
  phone_number: ad.phoneNumber,
  whatsapp: ad.whatsapp ?? null,
  placement: ad.placement ?? 'all',
  priority: ad.priority ?? 1,
  is_active: ad.isActive ?? true,
  start_date: ad.startDate ?? null,
  end_date: ad.endDate ?? null,
  ad_fee: ad.adFee ?? 0,
  daily_impression_limit: ad.dailyImpressionLimit ?? 0,
  whatsapp_clicks: ad.whatsappClicks ?? 0,
  region_id: ad.regionId ?? null,
});

export const fetchAds = async (): Promise<Ad[]> => {
  try {
    const { data, error } = await supabase
      .from('ads')
      .select('*')
      .order('is_active', { ascending: false })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (!error && data && data.length > 0) {
      return data.map(mapAdRow);
    }
    if (error) {
      console.warn('fetchAds error:', error.message);
    }
  } catch (err: any) {
    console.warn('Could not fetch ads from Supabase:', err.message);
  }
  return [];
};

export const fetchActiveAdsForPlacement = async (placement: 'home' | 'waiting' | 'popup'): Promise<Ad[]> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('ads')
      .select('*')
      .eq('is_active', true)
      .or(`placement.eq.all,placement.eq.${placement}`)
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (!error && data && data.length > 0) {
      return data.map(mapAdRow);
    }
    if (error) {
      console.warn('fetchActiveAdsForPlacement error:', error.message);
    }
  } catch (err: any) {
    console.warn('Could not fetch active ads:', err.message);
  }
  return [];
};

export const saveAd = async (ad: Partial<Ad> & { id?: string }): Promise<Ad | null> => {
  let savedAd: Ad | null = null;
  
  // Direct Supabase table upsert (no Edge Function, no localStorage fallback)
  try {
    const row = adToRow(ad);
    const id = ad.id || `ad_${Date.now()}`;
    const { data, error } = await supabase.from('ads').upsert({ id, ...row }).select().single();
    if (!error && data) {
      savedAd = mapAdRow(data);
    } else if (error) {
      console.warn('saveAd Supabase error:', error.message);
    }
  } catch (err: any) {
    console.warn('saveAd failed:', err.message);
  }

  return savedAd;
};

export const deleteAd = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ads').delete().eq('id', id);
    if (error) {
      console.warn('deleteAd Supabase error:', error.message);
    }
    return !error;
  } catch (err: any) {
    console.warn('deleteAd failed:', err.message);
    return false;
  }
};

export const incrementAdClick = async (id: string): Promise<void> => {
  try {
    await supabase.rpc('increment_ad_click', { ad_id: id });
  } catch (err: any) {
    console.warn('incrementAdClick failed:', err.message);
  }
};

export const incrementAdWhatsappClick = async (id: string): Promise<void> => {
  try {
    await supabase.rpc('increment_ad_whatsapp', { ad_id: id });
  } catch (err: any) {
    console.warn('incrementAdWhatsappClick failed:', err.message);
  }
};

export const incrementAdImpression = async (id: string): Promise<void> => {
  try {
    await supabase.rpc('increment_ad_impression', { ad_id: id });
  } catch (err: any) {
    console.warn('incrementAdImpression failed:', err.message);
  }
};

export const sendNewTripNotification = async (params: {
  tripId: string;
  origin?: string;
  destination?: string;
  fare?: number;
  distance?: number;
}): Promise<{ sent: number; results: any[] }> => {
  console.warn('[sendNewTripNotification] Skipped: Edge Function not configured');
  return { sent: 0, results: [] };
};

// Push subscriptions helpers
export const savePushSubscription = async (driverId: string, subscription: any, userAgent?: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_push_subscriptions').upsert(
      {
        driver_id: driverId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh || subscription.p256dh || '',
        auth: subscription.keys?.auth || subscription.auth || '',
        user_agent: userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('savePushSubscription failed:', err.message);
    return false;
  }
};

export const removePushSubscription = async (endpoint: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('ezz_push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.warn('removePushSubscription failed:', err.message);
    return false;
  }
};

export const getDriverPushSubscriptions = async (driverId: string): Promise<any[]> => {
  try {
    const { data, error } = await supabase.from('ezz_push_subscriptions').select('*').eq('driver_id', driverId);
    if (error) throw error;
    return (data || []) as any[];
  } catch (err: any) {
    console.warn('getDriverPushSubscriptions failed:', err.message);
    return [];
  }
};

export const sendWebPushToDriver = async (driverId: string, payload: any): Promise<{ sent: number; results: any[] }> => {
  try {
    const subscriptions = await getDriverPushSubscriptions(driverId);
    if (!subscriptions.length) return { sent: 0, results: [] };

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const endpoint = `${baseUrl}/api/notify-driver`;

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
          }
          return response.json();
        })
      )
    );

    const settled = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 'rejected', reason: r.reason }));
    return { sent: settled.filter((r) => r && r.success).length, results: settled };
  } catch (err: any) {
    console.warn('sendWebPushToDriver failed:', err.message);
    return { sent: 0, results: [] };
  }
};

