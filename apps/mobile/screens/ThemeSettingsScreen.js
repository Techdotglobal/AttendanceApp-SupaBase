import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { changePassword } from '../utils/passwordChange';

export default function ThemeSettingsScreen({ navigation, route }) {
  const { user } = route.params;
  const { user: authUser } = useAuth(); // Get current logged-in user from AuthContext
  const { theme, themePreference, colors, setTheme, toggleTheme } = useTheme();
  const [selectedPreference, setSelectedPreference] = useState(themePreference);
  
  // Password change state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState({});
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleThemeChange = (newTheme) => {
    setSelectedPreference(newTheme);
    setTheme(newTheme);
  };

  const validatePasswordForm = () => {
    const errors = {};

    if (!currentPassword.trim()) {
      errors.currentPassword = 'Current password is required';
    }

    if (!newPassword.trim()) {
      errors.newPassword = 'New password is required';
    } else if (newPassword.length < 6) {
      errors.newPassword = 'Password must be at least 6 characters long';
    }

    if (!confirmPassword.trim()) {
      errors.confirmPassword = 'Please confirm your new password';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (currentPassword === newPassword) {
      errors.newPassword = 'New password must be different from current password';
    }

    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChangePassword = async () => {
    // Clear previous errors
    setPasswordErrors({});

    // Validate form
    if (!validatePasswordForm()) {
      return;
    }

    // Get user email from auth context or route params
    const userEmail = authUser?.email || user?.email;
    if (!userEmail) {
      Alert.alert('Error', 'Unable to get user email. Please try logging out and back in.');
      return;
    }

    setIsChangingPassword(true);

    try {
      const result = await changePassword(currentPassword, newPassword, userEmail);

      if (result.success) {
        Alert.alert(
          'Success',
          'Your password has been changed successfully.',
          [
            {
              text: 'OK',
              onPress: () => {
                // Reset form and close modal
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setPasswordErrors({});
                setShowPasswordModal(false);
              }
            }
          ]
        );
      } else {
        // Show error message
        Alert.alert('Error', result.error || 'Failed to change password');
      }
    } catch (error) {
      console.error('Error changing password:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const resetPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordErrors({});
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const ThemeOption = ({ value, label, icon, description }) => {
    const isSelected = selectedPreference === value;
    
    return (
      <TouchableOpacity
        onPress={() => handleThemeChange(value)}
        style={{
          backgroundColor: isSelected ? colors.primaryLight : colors.surface,
          borderColor: isSelected ? colors.primary : colors.border,
          borderWidth: 2,
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: isSelected ? colors.primary : colors.borderLight,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}
        >
          <Ionicons
            name={icon}
            size={20}
            color={isSelected ? colors.surface : colors.textSecondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: colors.text,
              marginBottom: 4,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: colors.textSecondary,
            }}
          >
            {description}
          </Text>
        </View>
        {isSelected && (
          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ padding: 16 }}>
        {/* Header */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 20,
            marginBottom: 16,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.primaryLight,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Ionicons name="color-palette" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: colors.text,
                }}
              >
                Theme Settings
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: colors.textSecondary,
                  marginTop: 4,
                }}
              >
                Choose your preferred theme
              </Text>
            </View>
          </View>
        </View>

        {/* Current Theme Info */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              color: colors.textSecondary,
              marginBottom: 8,
            }}
          >
            Current Theme
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: colors.surface,
                borderWidth: 2,
                borderColor: colors.border,
                marginRight: 12,
              }}
            />
            <Text
              style={{
                fontSize: 18,
                fontWeight: '600',
                color: colors.text,
                textTransform: 'capitalize',
              }}
            >
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </Text>
          </View>
        </View>

        {/* Theme Options */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: colors.text,
              marginBottom: 12,
            }}
          >
            Theme Preference
          </Text>

          <ThemeOption
            value="light"
            label="Light Mode"
            icon="sunny"
            description="Always use light theme"
          />

          <ThemeOption
            value="dark"
            label="Dark Mode"
            icon="moon"
            description="Always use dark theme"
          />

          <ThemeOption
            value="system"
            label="System Default"
            icon="phone-portrait"
            description="Follow device theme settings"
          />
        </View>

        {/* Quick Toggle */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: 4,
                }}
              >
                Quick Toggle
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textSecondary,
                }}
              >
                Toggle between light and dark mode
              </Text>
            </View>
            <Switch
              value={theme === 'dark'}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </View>

        {/* Preview */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: colors.text,
              marginBottom: 12,
            }}
          >
            Preview
          </Text>
          <View
            style={{
              backgroundColor: colors.background,
              borderRadius: 12,
              padding: 16,
              marginBottom: 8,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: colors.text,
                marginBottom: 4,
              }}
            >
              Sample Card
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: colors.textSecondary,
              }}
            >
              This is how content will look in {theme === 'dark' ? 'dark' : 'light'} mode
            </Text>
          </View>
          <View
            style={{
              backgroundColor: colors.primaryLight,
              borderRadius: 8,
              padding: 12,
              marginTop: 8,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: colors.primary,
                fontWeight: '500',
              }}
            >
              Primary color preview
            </Text>
          </View>
        </View>

        {/* Change Password Section */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primaryLight,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Ionicons name="lock-closed" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: colors.text,
                }}
              >
                Change Password
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textSecondary,
                  marginTop: 2,
                }}
              >
                Update your account password
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              resetPasswordForm();
              setShowPasswordModal(true);
            }}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 8,
              padding: 12,
              alignItems: 'center',
              marginTop: 8,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
              Change Password
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          resetPasswordForm();
          setShowPasswordModal(false);
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              maxHeight: '90%',
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: 'bold',
                    color: colors.text,
                  }}
                >
                  Change Password
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    resetPasswordForm();
                    setShowPasswordModal(false);
                  }}
                >
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Current Password */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
                  Current Password *
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: passwordErrors.currentPassword ? colors.error : colors.border,
                  }}
                >
                  <TextInput
                    style={{
                      flex: 1,
                      padding: 12,
                      color: colors.text,
                      fontSize: 16,
                    }}
                    placeholder="Enter current password"
                    placeholderTextColor={colors.textTertiary}
                    value={currentPassword}
                    onChangeText={(text) => {
                      setCurrentPassword(text);
                      if (passwordErrors.currentPassword) {
                        setPasswordErrors({ ...passwordErrors, currentPassword: null });
                      }
                    }}
                    secureTextEntry={!showCurrentPassword}
                    editable={!isChangingPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                    style={{ padding: 12 }}
                  >
                    <Ionicons
                      name={showCurrentPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                {passwordErrors.currentPassword && (
                  <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>
                    {passwordErrors.currentPassword}
                  </Text>
                )}
              </View>

              {/* New Password */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
                  New Password *
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: passwordErrors.newPassword ? colors.error : colors.border,
                  }}
                >
                  <TextInput
                    style={{
                      flex: 1,
                      padding: 12,
                      color: colors.text,
                      fontSize: 16,
                    }}
                    placeholder="Enter new password (min. 6 characters)"
                    placeholderTextColor={colors.textTertiary}
                    value={newPassword}
                    onChangeText={(text) => {
                      setNewPassword(text);
                      if (passwordErrors.newPassword) {
                        setPasswordErrors({ ...passwordErrors, newPassword: null });
                      }
                      // Clear confirm password error if passwords now match
                      if (text === confirmPassword && passwordErrors.confirmPassword) {
                        setPasswordErrors({ ...passwordErrors, confirmPassword: null });
                      }
                    }}
                    secureTextEntry={!showNewPassword}
                    editable={!isChangingPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword(!showNewPassword)}
                    style={{ padding: 12 }}
                  >
                    <Ionicons
                      name={showNewPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                {passwordErrors.newPassword && (
                  <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>
                    {passwordErrors.newPassword}
                  </Text>
                )}
                <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>
                  Password must be at least 6 characters long
                </Text>
              </View>

              {/* Confirm Password */}
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
                  Confirm New Password *
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: passwordErrors.confirmPassword ? colors.error : colors.border,
                  }}
                >
                  <TextInput
                    style={{
                      flex: 1,
                      padding: 12,
                      color: colors.text,
                      fontSize: 16,
                    }}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.textTertiary}
                    value={confirmPassword}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      if (passwordErrors.confirmPassword) {
                        setPasswordErrors({ ...passwordErrors, confirmPassword: null });
                      }
                    }}
                    secureTextEntry={!showConfirmPassword}
                    editable={!isChangingPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{ padding: 12 }}
                  >
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                {passwordErrors.confirmPassword && (
                  <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>
                    {passwordErrors.confirmPassword}
                  </Text>
                )}
              </View>

              {/* Action Buttons */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: colors.border,
                    borderRadius: 8,
                    padding: 14,
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    resetPasswordForm();
                    setShowPasswordModal(false);
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 16 }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: colors.primary,
                    borderRadius: 8,
                    padding: 14,
                    alignItems: 'center',
                    opacity: isChangingPassword ? 0.6 : 1,
                  }}
                  onPress={handleChangePassword}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: 'white', fontWeight: '600', fontSize: 16 }}>
                      Change Password
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

