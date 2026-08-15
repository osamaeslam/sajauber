-- Add driver status and ensure fcm_token exists in sessions
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'IN_TRIP', 'BUSY'));
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS active_trip_id TEXT REFERENCES ezz_active_trip(id);
ALTER TABLE ezz_sessions ADD COLUMN IF NOT EXISTS fcm_token TEXT;
CREATE INDEX IF NOT EXISTS idx_drivers_status ON ezz_drivers(status, approval_status);
