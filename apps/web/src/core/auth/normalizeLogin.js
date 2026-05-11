export function trimCredential(value) {
  return String(value ?? '').trim();
}

export function normalizeEmailForAuth(email) {
  return trimCredential(email).toLowerCase();
}

export function parseLoginIdentifier(usernameOrEmail) {
  const ident = trimCredential(usernameOrEmail);
  return { ident, isEmail: ident.includes('@') };
}

export function usernameEqVariants(ident) {
  const t = trimCredential(ident);
  if (!t || t.includes('@')) return [];
  const out = [t];
  const lower = t.toLowerCase();
  if (lower !== t) out.push(lower);
  return [...new Set(out)];
}
