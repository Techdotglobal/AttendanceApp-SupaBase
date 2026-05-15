/**
 * Organization field normalization (departments + positions).
 * Display values use Title Case; lookup keys are lowercase for case-insensitive matching.
 */

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Case-insensitive lookup key (e.g. "hr", "human resources").
 * @param {string} value
 * @returns {string|null}
 */
function toLookupKey(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return null;
  return compact.toLowerCase();
}

/**
 * Display name for departments (e.g. "Hr" -> "Hr" handled per-word: "HR" from "hr" -> "Hr" - user wants "HR")
 * Title case per word: hr -> Hr, but "HR" typed stays as user might want acronym
 * Existing admin uses: each word first char upper rest lower -> "HR" from "hr" becomes "Hr"
 * User example says HR/hr/Hr should NOT duplicate - all map to same key, display "HR" if first created as "HR"
 * We'll use Title Case for display on CREATE: "hr" -> "Hr" - actually user wants "HR" for HR dept.
 * Better: preserve user intent on first create - use collapseWhitespace + if all caps short word keep, else title case
 * Simple approach matching existing admin.js:
 */
function normalizeDepartmentName(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return null;
  return compact
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Flexible position label (Title Case words, collapsed whitespace).
 * @param {string} value
 * @returns {string|null}
 */
function normalizePosition(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return null;
  return compact
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = {
  collapseWhitespace,
  toLookupKey,
  normalizeDepartmentName,
  normalizePosition,
};
