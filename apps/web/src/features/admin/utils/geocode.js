/**
 * Reverse geocoding for the web geofencing UI. Mirrors the mobile app's
 * approach (apps/mobile/utils/location.js getAddressFromCoordinates) — a
 * plain fetch against OpenStreetMap Nominatim's free reverse endpoint, with a
 * timeout and a formatted-coordinate fallback. Never invents a name: when the
 * lookup fails or returns nothing usable, callers fall back to coordinates.
 */

const GEOCODE_TIMEOUT_MS = 6000;

function formatCoordinateFallback(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function trimAddress(displayName) {
  if (!displayName || typeof displayName !== 'string') return null;
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d+$/.test(part)); // drop bare postal codes
  if (parts.length === 0) return null;
  return parts.slice(0, 4).join(', ');
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>} a human-readable address, or a formatted
 *   "lat, lng" string when reverse geocoding is unavailable.
 */
export async function reverseGeocode(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '—';

  const fallback = formatCoordinateFallback(latitude, longitude);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&zoom=18`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return fallback;
    const data = await response.json();
    return trimAddress(data?.display_name) || fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
