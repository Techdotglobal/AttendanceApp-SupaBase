-- ============================================
-- 20260912090000_sites_address.sql
-- Adds a nullable, best-effort human-readable address to sites so the web
-- geofencing UI can show a location name instead of only lat/lng. Populated
-- via reverse geocoding (client-side, OpenStreetMap Nominatim) when a site is
-- created/edited; never invented server-side and always optional — falls
-- back to raw coordinates when absent.
-- ============================================

BEGIN;

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS address text;

COMMIT;
