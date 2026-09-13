/**
 * Supabase's manual `exchangeCodeForSession` (required on React Native, where
 * there is no URL bar for `detectSessionInUrl` to parse) always notifies
 * `onAuthStateChange` with a plain `SIGNED_IN` event — it never emits
 * `PASSWORD_RECOVERY` the way the browser SDK does. Without this flag,
 * AuthContext would treat a password-reset deep link as a real login and
 * route the user straight into the app instead of the "set new password"
 * screen. AppNavigator sets this before exchanging a reset-password link;
 * AuthContext checks it to skip adopting that session as a normal sign-in;
 * ResetPasswordScreen clears it once the reset flow ends (success or bail-out).
 */
let active = false;

export function setPasswordRecoveryActive(value) {
  active = Boolean(value);
}

export function isPasswordRecoveryActive() {
  return active;
}
