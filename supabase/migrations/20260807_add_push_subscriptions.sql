-- Push subscriptions table for Web Push notifications
-- Each driver registers a push subscription that the server uses to send
-- push notifications directly to the browser (no Firebase needed).

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

-- Enable Row Level Security (table is created with RLS by default in Supabase)
-- but we explicitly enable it for safety.
ALTER TABLE ezz_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow anon users to read, insert, update, and delete push subscriptions.
-- The app uses the Supabase anon key directly from client-side code.
-- Data isolation is enforced client-side (drivers only manage their own subscriptions).
CREATE POLICY "anon can select push subscriptions" ON ezz_push_subscriptions FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert push subscriptions" ON ezz_push_subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update push subscriptions" ON ezz_push_subscriptions FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete push subscriptions" ON ezz_push_subscriptions FOR DELETE TO anon USING (true);

-- Keep updated_at in sync on row changes
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
