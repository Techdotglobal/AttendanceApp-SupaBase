/**
 * Supabase Auth emails are lowercased server-side; signIn must use the same form.
 */

export function trimCredential(value) {
  return String(value ?? '').trim();
}

export function normalizeEmailForAuth(email) {
  return trimCredential(email).toLowerCase();
}

/**
 * @param {string} usernameOrEmail
 */
export function parseLoginIdentifier(usernameOrEmail) {
  const ident = trimCredential(usernameOrEmail);
  return { ident, isEmail: ident.includes('@') };
}

/**
 * Usernames to try for exact `users.username` match (Postgres = is case-sensitive).
 * @param {string} ident - trimmed identifier without @
 */
export function usernameEqVariants(ident) {
  const t = trimCredential(ident);
  if (!t || t.includes('@')) return [];
  const out = [t];
  const lower = t.toLowerCase();
  if (lower !== t) out.push(lower);
  return [...new Set(out)];
}
