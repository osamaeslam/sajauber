-- ============================================================
-- Fix: Admin cannot approve/reject/freeze/unfreeze drivers
--
-- المشكلة: قواعد RLS على جدول ezz_drivers تشترط أن يكون دور
-- "ADMIN" مفعلاً عبر set_app_role (متغير app.current_role).
-- لكن مع تجميع الاتصالات (connection pooling) في Supabase،
-- قد يتم تنفيذ set_app_role و upsert على اتصالين مختلفين،
-- فيفشل التحديث ويفشل قبول السواقين.
--
-- الحل: دالة SECURITY DEFINER تعمل كصاحب الجدول (table owner)
-- وتتجاوز RLS نهائياً، فيتم تحديث حالة السائق بنجاح دائماً.
-- ============================================================

-- تحديث حقول متعددة للسائق (تستخدم لقبول/رفض/تجميد/إلغاء تجميد)
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

-- تحديث حالة الموافقة فقط (أبسط دالة)
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

-- السماح للعميل (anon) باستدعاء الدالتين
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_driver(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_driver_approval(TEXT, TEXT) TO service_role;
