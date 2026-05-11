import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createEmployee } from '../utils/employees';
import { WORK_MODES } from '../utils/workModes';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont, wp } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
];

const WORK_MODE_OPTIONS = [
  { value: WORK_MODES.IN_OFFICE, label: 'In Office' },
  { value: WORK_MODES.SEMI_REMOTE, label: 'Semi Remote' },
  { value: WORK_MODES.FULLY_REMOTE, label: 'Fully Remote' },
];

export default function CreateUserScreen({ navigation, route }) {
  const { user: routeUser } = route.params || {};
  const { user: authUser } = useAuth();
  const user = authUser || routeUser || {};
  const { colors } = useTheme();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    name: '',
    email: '',
    role: 'employee',
    department: '',
    position: '',
    workMode: WORK_MODES.IN_OFFICE,
    hireDate: new Date().toISOString().split('T')[0],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    if (!formData.username.trim()) {
      Alert.alert('Validation Error', 'Username is required');
      return false;
    }
    if (formData.username.length < 3) {
      Alert.alert('Validation Error', 'Username must be at least 3 characters');
      return false;
    }
    if (!formData.password) {
      Alert.alert('Validation Error', 'Password is required');
      return false;
    }
    if (formData.password.length < 6) {
      Alert.alert('Validation Error', 'Password must be at least 6 characters');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match');
      return false;
    }
    if (!formData.name.trim()) {
      Alert.alert('Validation Error', 'Full name is required');
      return false;
    }
    if (!formData.email.trim()) {
      Alert.alert('Validation Error', 'Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      Alert.alert('Validation Error', 'Please enter a valid email address');
      return false;
    }
    return true;
  };

  const handleCreateUser = async () => {
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      const result = await createEmployee({
        username: formData.username.trim(),
        password: formData.password,
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department.trim(),
        position: formData.position.trim(),
        workMode: formData.workMode,
        hireDate: formData.hireDate,
        companyId: user?.companyId ?? null,
      });

      if (result.success) {
        Alert.alert(
          'Success',
          'User created successfully!',
          [
            {
              text: 'OK',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to create user');
      }
    } catch (error) {
      console.error('Create user error:', error);
      Alert.alert('Error', `An error occurred: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: responsivePadding(24) }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="items-center" style={{ marginBottom: spacing['2xl'] }}>
          <Logo size="medium" style={{ marginBottom: spacing.md }} />
          <Text
            className="font-bold"
            style={{
              color: colors.text,
              fontSize: responsiveFont(24),
              marginBottom: spacing.xs,
            }}
          >
            Create New User
          </Text>
          <Text
            className="text-center"
            style={{
              color: colors.textSecondary,
              fontSize: responsiveFont(14),
            }}
          >
            Add a new user to the system
          </Text>
        </View>

        {/* Form */}
        <View
          className="rounded-2xl shadow-lg"
          style={{
            backgroundColor: colors.surface,
            padding: responsivePadding(24),
          }}
        >
          {/* Username */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Username *
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="person-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter username"
                value={formData.username}
                onChangeText={(value) => handleInputChange('username', value)}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Password */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Password *
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="lock-closed-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter password"
                value={formData.password}
                onChangeText={(value) => handleInputChange('password', value)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ marginLeft: spacing.xs }}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm Password */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Confirm Password *
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="lock-closed-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Confirm password"
                value={formData.confirmPassword}
                onChangeText={(value) => handleInputChange('confirmPassword', value)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Name */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Full Name *
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="person-circle-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter full name"
                value={formData.name}
                onChangeText={(value) => handleInputChange('name', value)}
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Email */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Email *
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="mail-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter email"
                value={formData.email}
                onChangeText={(value) => handleInputChange('email', value)}
                keyboardType="email-address"
                autoCapitalize="none"
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Role */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Role *
            </Text>
            <View className="flex-row" style={{ gap: spacing.sm }}>
              {ROLES.map((role) => {
                const isSelected = formData.role === role.value;
                return (
                  <TouchableOpacity
                    key={role.value}
                    className="flex-1 rounded-xl"
                    style={{ 
                      backgroundColor: isSelected ? colors.primary : colors.borderLight,
                      paddingVertical: spacing.sm, 
                      alignItems: 'center' 
                    }}
                    onPress={() => handleInputChange('role', role.value)}
                  >
                    <Text 
                      className="font-medium" 
                      style={{ 
                        color: isSelected ? '#ffffff' : colors.text,
                        fontSize: responsiveFont(14) 
                      }}
                    >
                      {role.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Department */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Department
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="business-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter department"
                value={formData.department}
                onChangeText={(value) => handleInputChange('department', value)}
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Position */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Position
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="briefcase-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Enter position"
                value={formData.position}
                onChangeText={(value) => handleInputChange('position', value)}
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Work Mode */}
          <View style={{ marginBottom: spacing.md }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Work Mode
            </Text>
            <View className="flex-row" style={{ gap: spacing.sm }}>
              {WORK_MODE_OPTIONS.map((mode) => {
                const isSelected = formData.workMode === mode.value;
                return (
                  <TouchableOpacity
                    key={mode.value}
                    className="flex-1 rounded-xl"
                    style={{ 
                      backgroundColor: isSelected ? colors.primary : colors.borderLight,
                      paddingVertical: spacing.sm, 
                      alignItems: 'center' 
                    }}
                    onPress={() => handleInputChange('workMode', mode.value)}
                  >
                    <Text 
                      className="font-medium" 
                      style={{ 
                        color: isSelected ? '#ffffff' : colors.text,
                        fontSize: responsiveFont(12) 
                      }}
                    >
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Hire Date */}
          <View style={{ marginBottom: spacing.lg }}>
            <Text className="font-medium" style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}>
              Hire Date
            </Text>
            <View className="flex-row items-center rounded-xl" style={{ backgroundColor: colors.borderLight, paddingHorizontal: responsivePadding(16), paddingVertical: spacing.md }}>
              <Ionicons name="calendar-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="YYYY-MM-DD"
                value={formData.hireDate}
                onChangeText={(value) => handleInputChange('hireDate', value)}
                style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          {/* Create Button */}
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: componentSize.buttonHeight / 2,
              alignItems: 'center',
              marginBottom: spacing.base,
              opacity: isLoading ? 0.5 : 1,
              minHeight: componentSize.buttonHeight,
              justifyContent: 'center',
            }}
            onPress={handleCreateUser}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <Text style={{ color: 'white', fontWeight: '600', fontSize: responsiveFont(16) }}>
                Creating...
              </Text>
            ) : (
              <Text style={{ color: 'white', fontWeight: '600', fontSize: responsiveFont(18) }}>
                Create User
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Trademark */}
        <Trademark position="bottom" style={{ marginTop: spacing['2xl'] }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}


