-- Fix driver query timeout caused by missing index for RLS policy
-- public_read_approved_drivers filters on approval_status = 'APPROVED'
-- but the existing composite index (status, approval_status) is not
-- efficient for this filter, causing full table scans and timeouts.

-- Partial index: only approved drivers (keeps index tiny and fast)
CREATE INDEX IF NOT EXISTS idx_drivers_approved
ON ezz_drivers WHERE approval_status = 'APPROVED';

-- Speed up RLS subqueries in driver_read_own / admin_read_all_drivers
CREATE INDEX IF NOT EXISTS idx_ezz_sessions_role_user_id
ON ezz_sessions(role, user_id);
