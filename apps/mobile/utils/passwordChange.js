/**
 * Password Change Utility
 * Secure password change using Supabase Auth only
 * 
 * SECURITY:
 * - Passwords are managed ONLY by Supabase Auth
 * - Passwords are NOT stored in PostgreSQL or AsyncStorage
 * - Each user can ONLY change their own password
 */

import { supabase } from '../core/config/supabase';
import { normalizeEmailForAuth } from '../core/auth/normalizeLogin';

/**
 * Change user password
 * 
 * Flow:
 * 1. Re-authenticate user with current password
 * 2. If valid, update password using Supabase Auth
 * 
 * @param {string} currentPassword - User's current password
 * @param {string} newPassword - New password
 * @param {string} userEmail - User's email (required for re-authentication)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const changePassword = async (currentPassword, newPassword, userEmail) => {
  try {
    // Validate inputs
    if (!currentPassword || !newPassword || !userEmail) {
      return {
        success: false,
        error: 'Current password, new password, and email are required'
      };
    }

    // Validate password strength (minimum 6 characters as per Supabase default)
    if (newPassword.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long'
      };
    }

    // Step 1: Re-authenticate user with current password
    // This ensures the user knows their current password before changing it
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: normalizeEmailForAuth(userEmail),
      password: currentPassword,
    });

    if (authError) {
      console.error('Re-authentication error:', authError.message);
      
      // Handle specific error cases
      if (authError.message?.includes('Invalid login credentials')) {
        return {
          success: false,
          error: 'Current password is incorrect'
        };
      }
      
      if (authError.message?.includes('Email rate limit exceeded')) {
        return {
          success: false,
          error: 'Too many attempts. Please try again later'
        };
      }

      return {
        success: false,
        error: authError.message || 'Failed to verify current password'
      };
    }

    if (!authData.user) {
      return {
        success: false,
        error: 'Failed to verify current password'
      };
    }

    // Step 2: Update password using Supabase Auth
    // Note: After re-authentication, we have a valid session
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      console.error('Password update error:', updateError.message);
      
      // Handle specific error cases
      if (updateError.message?.includes('Password should be at least')) {
        return {
          success: false,
          error: 'Password does not meet security requirements'
        };
      }

      if (updateError.message?.includes('same as the old password')) {
        return {
          success: false,
          error: 'New password must be different from current password'
        };
      }

      return {
        success: false,
        error: updateError.message || 'Failed to update password'
      };
    }

    console.log('✓ Password changed successfully');
    return {
      success: true
    };

  } catch (error) {
    console.error('Error changing password:', error);
    
    // Handle network errors
    if (error.message?.includes('Network') || error.message?.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your connection and try again'
      };
    }

    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    };
  }
};
