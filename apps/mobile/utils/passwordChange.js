/**
 * Password Change Utility
 * Secure password change using Supabase Auth only
 *
 * SECURITY:
 * - Passwords are managed ONLY by Supabase Auth
 * - Passwords are NOT stored in PostgreSQL or AsyncStorage (except optional Remember Me)
 * - Each user can ONLY change their own password
 */

import { supabase } from '../core/config/supabase';
import { normalizeEmailForAuth } from '../core/auth/normalizeLogin';
import { loadCredentials, saveCredentials } from './credentialsStorage';

const PASSWORD_CHANGE_TIMEOUT_MS = 30000;

const withTimeout = (promise, ms, timeoutMessage) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(timeoutMessage || 'Request timed out. Please try again.'));
      }, ms);
    }),
  ]);

/**
 * Resolve the auth email for the active session (canonical for sign-in).
 */
export const resolvePasswordChangeEmail = async (fallbackEmail) => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.warn('[passwordChange] getUser failed:', error.message);
  }
  const sessionEmail = user?.email?.trim();
  if (sessionEmail) {
    return normalizeEmailForAuth(sessionEmail);
  }
  if (fallbackEmail?.trim()) {
    return normalizeEmailForAuth(fallbackEmail.trim());
  }
  return null;
};

/**
 * Change user password
 *
 * Flow:
 * 1. Re-authenticate with current password (verifies identity)
 * 2. Update password on the active session
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} [fallbackEmail] - Used only if session email is unavailable
 */
export const changePassword = async (currentPassword, newPassword, fallbackEmail) => {
  try {
    if (!currentPassword || !newPassword) {
      return {
        success: false,
        error: 'Current password and new password are required',
      };
    }

    if (newPassword.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long',
      };
    }

    if (currentPassword === newPassword) {
      return {
        success: false,
        error: 'New password must be different from current password',
      };
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      return {
        success: false,
        error: 'Your session has expired. Please sign in again and retry.',
      };
    }

    const userEmail = await resolvePasswordChangeEmail(fallbackEmail);
    if (!userEmail) {
      return {
        success: false,
        error: 'Unable to determine your account email. Please sign out and sign in again.',
      };
    }

    const { data: authData, error: authError } = await withTimeout(
      supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      }),
      PASSWORD_CHANGE_TIMEOUT_MS,
      'Verifying your current password timed out. Please try again.'
    );

    if (authError) {
      console.error('Re-authentication error:', authError.message);

      if (authError.message?.includes('Invalid login credentials')) {
        return {
          success: false,
          error: 'Current password is incorrect',
        };
      }

      if (authError.message?.includes('Email rate limit exceeded')) {
        return {
          success: false,
          error: 'Too many attempts. Please try again later',
        };
      }

      return {
        success: false,
        error: authError.message || 'Failed to verify current password',
      };
    }

    if (!authData?.user) {
      return {
        success: false,
        error: 'Failed to verify current password',
      };
    }

    const { error: updateError } = await withTimeout(
      supabase.auth.updateUser({ password: newPassword }),
      PASSWORD_CHANGE_TIMEOUT_MS,
      'Updating your password timed out. Please try again.'
    );

    if (updateError) {
      console.error('Password update error:', updateError.message);

      if (updateError.message?.includes('Password should be at least')) {
        return {
          success: false,
          error: 'Password does not meet security requirements',
        };
      }

      if (updateError.message?.includes('same as the old password')) {
        return {
          success: false,
          error: 'New password must be different from current password',
        };
      }

      return {
        success: false,
        error: updateError.message || 'Failed to update password',
      };
    }

    try {
      const saved = await loadCredentials();
      if (saved.rememberMe && saved.username && saved.password) {
        await saveCredentials(saved.username, newPassword);
        console.log('[passwordChange] Updated saved credentials for Remember Me / biometric');
      }
    } catch (credErr) {
      console.warn('[passwordChange] Could not update saved credentials:', credErr?.message);
    }

    console.log('✓ Password changed successfully');
    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);

    if (error.message?.includes('timed out')) {
      return { success: false, error: error.message };
    }

    if (error.message?.includes('Network') || error.message?.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your connection and try again',
      };
    }

    return {
      success: false,
      error: error.message || 'An unexpected error occurred',
    };
  }
};
