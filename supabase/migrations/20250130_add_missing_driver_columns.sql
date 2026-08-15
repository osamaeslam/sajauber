-- Migration: Add missing driver columns for existing projects
-- Run this in Supabase SQL Editor if you already have the ezz_drivers table

ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS service_areas TEXT[] DEFAULT '{}';
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN DEFAULT false;
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS auto_show_map BOOLEAN DEFAULT false;
ALTER TABLE ezz_drivers ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Index for faster filtering by service area
CREATE INDEX IF NOT EXISTS idx_drivers_service_areas ON ezz_drivers USING GIN(service_areas);

-- Enable realtime for the table (required for location updates and trip notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE ezz_drivers;
