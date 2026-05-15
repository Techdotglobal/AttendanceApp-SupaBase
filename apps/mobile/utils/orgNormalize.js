/**
 * Client-side org field normalization (mirrors auth-service orgNormalize).
 */

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function departmentLookupKey(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return '';
  return compact.toLowerCase();
}

export function normalizeDepartmentDisplay(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return '';
  return compact
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizePositionDisplay(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return '';
  return compact
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function departmentNamesMatch(a, b) {
  const ka = departmentLookupKey(a);
  const kb = departmentLookupKey(b);
  return ka.length > 0 && ka === kb;
}
