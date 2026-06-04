/**
 * Organization field normalization (departments + positions).
 * Department display values preserve user-entered casing; lookup keys are lowercase
 * for case-insensitive matching.
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
 * Display name for departments. Keep the original casing/wording the company
 * entered, while collapsing accidental repeated whitespace.
 */
function normalizeDepartmentName(value) {
  const compact = collapseWhitespace(value);
  if (!compact) return null;
  return compact;
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
