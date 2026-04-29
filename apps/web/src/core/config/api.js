/**
 * Backend origin (e.g. Render API gateway). Must be absolute — never rely on same-origin /api.
 * Set on Vercel: VITE_API_GATEWAY_URL and/or NEXT_PUBLIC_API_URL (both are read at build time).
 */
const raw =
  String(import.meta.env?.NEXT_PUBLIC_API_URL ?? '').trim() ||
  String(import.meta.env?.VITE_API_GATEWAY_URL ?? '').trim();

const API_BASE_URL = raw.replace(/\/+$/, '');

/**
 * @param {string} path - Gateway path, e.g. "/api/auth/login"
 * @returns {string} Absolute URL to the Render (or other) backend
 */
export function apiUrl(path) {
  if (path == null || path === '') return API_BASE_URL;
  const s = String(path).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const normalized = s.startsWith('/') ? s : `/${s}`;
  if (!API_BASE_URL) return normalized;
  return `${API_BASE_URL}${normalized}`;
}

export const IS_API_GATEWAY_CONFIGURED = Boolean(API_BASE_URL);
export const IS_API_GATEWAY_LOCAL =
  /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168/i.test(API_BASE_URL);

export { API_BASE_URL };

export default API_BASE_URL;
