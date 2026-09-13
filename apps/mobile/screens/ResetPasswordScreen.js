/**
 * Reset Password Screen
 * Allows users to set a new password after clicking reset link in email
 * 
 * SECURITY:
 * - Supabase handles token validation automatically
 * - User is auto-authenticated via recovery token in deep link
 * - No password data stored
 * - Uses Supabase Auth only
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../core/config/supabase';
import { useAuth } from '../core/contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';
import { KeyboardAwareScreen } from '../shared/components/KeyboardAwareScreen';
import { setPasswordRecoveryActive } from '../core/auth/passwordRecoveryFlag';

export default function ResetPasswordScreen({ route }) {
  const navigation = useNavigation();
  const { user, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [hasValidSession, setHasValidSession] = useState(false);

  // Check if user has a valid recovery session
  useEffect(() => {
    const checkSession = async () => {
      try {
        // Wait a bit for Supabase to process the recovery token from deep link
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && !error) {
          // Supabase automatically creates a session when recovery token is used
          // This session allows password update
          setHasValidSession(true);
          console.log('✓ Valid recovery session detected for password reset');
        } else {
          // No valid session - user might need to click the email link again
          console.warn('⚠ No valid recovery session found');
          // Don't show alert immediately - let user see the screen first
          // They can request a new link if needed
        }
      } catch (error) {
        console.error('Error checking session:', error);
        // Don't block the UI - let user try to reset anyway
      }
    };

    checkSession();

    // Safety net: however this screen is left (success, expired-link bail-out,
    // hardware back), clear the flag so a genuine future login isn't ignored
    // by AuthContext. The success path also clears it explicitly before
    // signing out, since that happens well before this screen unmounts.
    return () => setPasswordRecoveryActive(false);
  }, []);

  const validateForm = () => {
    const newErrors = {};

    if (!newPassword.trim()) {
      newErrors.newPassword = 'New password is required';
    } else if (newPassword.length < 6) {
      newErrors.newPassword = 'Password must be at least 6 characters long';
    }

    if (!confirmPassword.trim()) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleResetPassword = async () => {
    // Clear previous errors
    setErrors({});

    // Validate form
    if (!validateForm()) {
      return;
    }

    // Verify session is still valid
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      Alert.alert(
        'Session Expired',
        'Your password reset session has expired. Please request a new password reset link.',
        [
          {
            text: 'Request New Link',
            onPress: () => navigation.navigate('ForgotPassword'),
          },
        ]
      );
      return;
    }

    setIsResetting(true);

    try {
      // Update password using Supabase Auth
      // Supabase automatically validates the recovery token
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        console.error('Password reset error:', updateError.message);
        
        // Handle specific error cases
        if (updateError.message?.includes('Password should be at least')) {
          setErrors({
            newPassword: 'Password does not meet security requirements',
          });
          return;
        }

        if (updateError.message?.includes('same as the old password')) {
          setErrors({
            newPassword: 'New password must be different from your current password',
          });
          return;
        }

        if (updateError.message?.includes('expired') || updateError.message?.includes('invalid')) {
          Alert.alert(
            'Link Expired',
            'This password reset link has expired. Please request a new password reset link.',
            [
              {
                text: 'Request New Link',
                onPress: () => navigation.navigate('ForgotPassword'),
              },
            ]
          );
          return;
        }

        Alert.alert('Error', updateError.message || 'Failed to reset password. Please try again.');
        return;
      }

      // Success - password has been reset
      console.log('✓ Password reset successfully');
      
      Alert.alert(
        'Password Reset Successful',
        'Your password has been changed successfully. You can now login with your new password.',
        [
          {
            text: 'Go to Login',
            onPress: async () => {
              // Sign out to ensure clean state (Supabase recovery session is temporary)
              try {
                setPasswordRecoveryActive(false);
                await supabase.auth.signOut();
                // Navigate to login screen
                if (navigation.canGoBack()) {
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login' }],
                  });
                } else {
                  navigation.navigate('Login');
                }
              } catch (signOutError) {
                console.error('Error signing out:', signOutError);
                // Navigate anyway
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              }
            },
          },
        ]
      );

    } catch (error) {
      console.error('Error resetting password:', error);
      
      // Handle network errors
      if (error.message?.includes('Network') || error.message?.includes('fetch')) {
        Alert.alert(
          'Network Error',
          'Unable to connect. Please check your internet connection and try again.'
        );
      } else {
        Alert.alert(
          'Error',
          'An unexpected error occurred. Please try again.'
        );
      }
    } finally {
      setIsResetting(false);
    }
  };

  // Show loading while checking session
  if (authLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text
          style={{
            color: colors.textSecondary,
            marginTop: spacing.md,
            fontSize: responsiveFont(14),
          }}
        >
          Verifying reset link...
        </Text>
      </View>
    );
  }

  // Don't show form if no valid session
  if (!hasValidSession) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
          paddingHorizontal: responsivePadding(32),
        }}
      >
        <Ionicons name="lock-closed-outline" size={64} color={colors.textTertiary} />
        <Text
          style={{
            color: colors.text,
            fontSize: responsiveFont(18),
            fontWeight: '600',
            marginTop: spacing.lg,
            textAlign: 'center',
          }}
        >
          Invalid Reset Link
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: responsiveFont(14),
            marginTop: spacing.md,
            textAlign: 'center',
          }}
        >
          This password reset link is invalid or has expired.
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ForgotPassword')}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            marginTop: spacing.xl,
          }}
        >
          <Text
            style={{
              color: 'white',
              fontWeight: '600',
              fontSize: responsiveFont(16),
            }}
          >
            Request New Link
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAwareScreen
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ justifyContent: 'center', paddingHorizontal: responsivePadding(32) }}
      extraScrollHeight={48}
    >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
          }}
        >
          {/* Header */}
          <View
            style={{
              alignItems: 'center',
              marginBottom: spacing['3xl'],
            }}
          >
            <Logo size="medium" style={{ marginBottom: spacing.lg }} />
            <Text
              style={{
                color: colors.text,
                fontSize: responsiveFont(30),
                fontWeight: 'bold',
                marginBottom: spacing.xs,
              }}
            >
              Set New Password
            </Text>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: responsiveFont(14),
                textAlign: 'center',
              }}
            >
              Enter your new password below
            </Text>
          </View>

          {/* Form */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: responsivePadding(24),
            }}
          >
            {/* New Password Input */}
            <View style={{ marginBottom: spacing.md }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: responsiveFont(14),
                  fontWeight: '600',
                  marginBottom: spacing.xs,
                }}
              >
                New Password *
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.borderLight,
                  borderRadius: 12,
                  paddingHorizontal: responsivePadding(16),
                  paddingVertical: spacing.md,
                  borderWidth: errors.newPassword ? 1 : 0,
                  borderColor: errors.newPassword ? colors.error : 'transparent',
                }}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={iconSize.md}
                  color={colors.textSecondary}
                />
                <TextInput
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: responsiveFont(14),
                    marginLeft: spacing.md,
                  }}
                  placeholder="Enter new password (min. 6 characters)"
                  placeholderTextColor={colors.textTertiary}
                  value={newPassword}
                  onChangeText={(text) => {
                    setNewPassword(text);
                    if (errors.newPassword) {
                      setErrors({ ...errors, newPassword: null });
                    }
                    // Clear confirm password error if passwords now match
                    if (text === confirmPassword && errors.confirmPassword) {
                      setErrors({ ...errors, confirmPassword: null });
                    }
                  }}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isResetting}
                />
                <TouchableOpacity
                  onPress={() => setShowNewPassword(!showNewPassword)}
                  style={{ marginLeft: spacing.xs }}
                  disabled={isResetting}
                >
                  <Ionicons
                    name={showNewPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={iconSize.md}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {errors.newPassword && (
                <Text
                  style={{
                    fontSize: responsiveFont(12),
                    color: colors.error,
                    marginTop: spacing.xs / 2,
                  }}
                >
                  {errors.newPassword}
                </Text>
              )}
              <Text
                style={{
                  fontSize: responsiveFont(12),
                  color: colors.textTertiary,
                  marginTop: spacing.xs / 2,
                }}
              >
                Password must be at least 6 characters long
              </Text>
            </View>

            {/* Confirm Password Input */}
            <View style={{ marginBottom: spacing.lg }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: responsiveFont(14),
                  fontWeight: '600',
                  marginBottom: spacing.xs,
                }}
              >
                Confirm New Password *
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.borderLight,
                  borderRadius: 12,
                  paddingHorizontal: responsivePadding(16),
                  paddingVertical: spacing.md,
                  borderWidth: errors.confirmPassword ? 1 : 0,
                  borderColor: errors.confirmPassword ? colors.error : 'transparent',
                }}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={iconSize.md}
                  color={colors.textSecondary}
                />
                <TextInput
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: responsiveFont(14),
                    marginLeft: spacing.md,
                  }}
                  placeholder="Confirm new password"
                  placeholderTextColor={colors.textTertiary}
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    if (errors.confirmPassword) {
                      setErrors({ ...errors, confirmPassword: null });
                    }
                  }}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isResetting}
                  onSubmitEditing={handleResetPassword}
                  returnKeyType="go"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ marginLeft: spacing.xs }}
                  disabled={isResetting}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={iconSize.md}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {errors.confirmPassword && (
                <Text
                  style={{
                    fontSize: responsiveFont(12),
                    color: colors.error,
                    marginTop: spacing.xs / 2,
                  }}
                >
                  {errors.confirmPassword}
                </Text>
              )}
            </View>

            {/* Reset Password Button */}
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: componentSize.buttonHeight / 2,
                alignItems: 'center',
                marginBottom: spacing.md,
                opacity: isResetting ? 0.5 : 1,
                minHeight: componentSize.buttonHeight,
                justifyContent: 'center',
              }}
              onPress={handleResetPassword}
              disabled={isResetting}
              activeOpacity={0.8}
            >
              {isResetting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text
                  style={{
                    color: 'white',
                    fontWeight: '600',
                    fontSize: responsiveFont(18),
                  }}
                >
                  Reset Password
                </Text>
              )}
            </TouchableOpacity>

            {/* Back to Login */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={{
                alignItems: 'center',
                marginTop: spacing.md,
              }}
              disabled={isResetting}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontSize: responsiveFont(14),
                }}
              >
                Back to Login
              </Text>
            </TouchableOpacity>
          </View>

          {/* Trademark */}
          <Trademark position="bottom" style={{ marginTop: spacing['2xl'] }} />
        </View>
    </KeyboardAwareScreen>
  );
}
