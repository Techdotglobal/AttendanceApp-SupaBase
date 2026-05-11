/**
 * Supabase GoTrue stores emails lowercased. Always normalize before signInWithPassword.
 * Username lookups use trimmed input; try case variants for Postgres case-sensitive `=`.
 */

function trimInput(value) {
  return String(value ?? '').trim();
}

function normalizeEmailForAuth(email) {
  return trimInput(email).toLowerCase();
}

/**
 * @param {string} usernameOrEmail - raw login field
 * @returns {{ ident: string, isEmail: boolean }}
 */
function parseLoginIdentifier(usernameOrEmail) {
  const ident = trimInput(usernameOrEmail);
  return { ident, isEmail: ident.includes('@') };
}

/**
 * Ordered username strings to try with `.eq('username', x)` (exact only, no ILIKE wildcards).
 * @param {string} ident - trimmed, no @
 */
function usernameEqVariants(ident) {
  const variants = [];
  const t = trimInput(ident);
  if (!t || t.includes('@')) return variants;
  variants.push(t);
  const lower = t.toLowerCase();
  if (lower !== t) variants.push(lower);
  return [...new Set(variants)];
}

module.exports = {
  trimInput,
  normalizeEmailForAuth,
  parseLoginIdentifier,
  usernameEqVariants,
};
