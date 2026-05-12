import React, { useState, useEffect } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { authenticateUser } from '../utils/auth';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  spacing,
  iconSize,
  componentSize,
  responsivePadding,
  responsiveFont,
  isTablet,
  getTabletNarrowContentMaxWidth,
  normalize,
} from '../utils/responsive';
import { saveCredentials, loadCredentials, clearCredentials } from '../utils/credentialsStorage';
import { 
  checkBiometricAvailability, 
  authenticateWithBiometric, 
  getBiometricTypeName 
} from '../utils/biometricAuth';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';
import { ROUTES } from '../shared/constants/routes';

export default function LoginScreen() {
  const navigation = useNavigation();
  const { handleLogin: loginUser } = useAuth();
  const { colors } = useTheme();
  const tablet = isTablet();
  const loginColumnMaxWidth = getTabletNarrowContentMaxWidth();
  const inputMinHeight = tablet ? normalize(52) : normalize(48);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('');
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);

  // Load saved credentials and check biometric availability on mount
  useEffect(() => {
    const initializeLogin = async () => {
      try {
        // Load saved credentials
        const saved = await loadCredentials();
        if (saved.rememberMe && saved.username) {
          setUsername(saved.username);
          setRememberMe(true);
          setHasSavedCredentials(true);
          // Optionally load password if saved
          if (saved.password) {
            setPassword(saved.password);
          }
        } else {
          setHasSavedCredentials(false);
        }

        // Check biometric availability
        const biometricCheck = await checkBiometricAvailability();
        if (biometricCheck.available) {
          setBiometricAvailable(true);
          const typeName = getBiometricTypeName(biometricCheck.types);
          setBiometricType(typeName);
          console.log(`✓ Biometric available: ${typeName}`);
        } else {
          setBiometricAvailable(false);
          console.log('Biometric not available:', biometricCheck.error);
        }
      } catch (error) {
        console.error('Error initializing login:', error);
      }
    };
    initializeLogin();
  }, []);

  const performLogin = async (usernameToUse, passwordToUse) => {
    setIsLoading(true);
    try {
      console.log('Attempting login for:', usernameToUse.trim());
      const result = await authenticateUser(usernameToUse.trim(), passwordToUse);
      console.log('Authentication result:', result);
      
      if (result.success) {
        // Save or clear credentials based on Remember Me checkbox
        if (rememberMe) {
          await saveCredentials(usernameToUse.trim(), passwordToUse);
          setHasSavedCredentials(true);
        } else {
          await clearCredentials();
          setHasSavedCredentials(false);
        }

        // Ensure employees are initialized first
        const { initializeDefaultEmployees, getEmployeeByUsername } = await import('../utils/employees');
        await initializeDefaultEmployees();
        
        // Fetch full employee data including department
        const employee = await getEmployeeByUsername(result.user.username, result.user.companyId);
        console.log('Employee lookup result:', employee);
        
        if (employee) {
          // Use employee data but prioritize auth role (more reliable)
          const userData = {
            username: employee.username,
            role: result.user.role, // Use role from authentication, not employee data
            department: employee.department,
            name: employee.name,
            email: employee.email,
            id: employee.id,
            companyId: result.user.companyId ?? employee.companyId ?? null,
            departmentId: result.user.departmentId ?? employee.departmentId ?? null,
            uid: result.user.uid ?? employee.uid ?? null,
          };
          console.log('Logging in with employee data (using auth role):', userData);
          loginUser(userData);
        } else {
          // Fallback to basic user data if employee not found
          const userData = {
            username: result.user.username,
            role: result.user.role,
            companyId: result.user.companyId ?? null,
            departmentId: result.user.departmentId ?? null,
            uid: result.user.uid ?? null,
          };
          console.log('Logging in with auth data (employee not found):', userData);
          loginUser(userData);
        }
      } else {
        console.log('Authentication failed');
        Alert.alert('Login Failed', result.error || 'Invalid username or password');
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Error', `An error occurred during login: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both username and password');
      return;
    }

    await performLogin(username, password);
  };

  const handleBiometricLogin = async () => {
    if (!hasSavedCredentials) {
      Alert.alert('No Saved Credentials', 'Please login with username and password first, and enable "Remember Me" to use biometric login.');
      return;
    }

    if (!biometricAvailable) {
      Alert.alert('Biometric Not Available', 'Biometric authentication is not available on this device. Please use username and password to login.');
      return;
    }

    setIsLoading(true);
    try {
      // First, authenticate with biometric
      const biometricResult = await authenticateWithBiometric(
        `Authenticate with ${biometricType} to login`
      );

      if (!biometricResult.success) {
        Alert.alert('Biometric Authentication Failed', biometricResult.error || 'Please try again');
        setIsLoading(false);
        return;
      }

      // Biometric authentication successful, now login with saved credentials
      const saved = await loadCredentials();
      if (!saved.username || !saved.password) {
        Alert.alert('Error', 'Saved credentials not found. Please login with username and password.');
        setIsLoading(false);
        return;
      }

      console.log('Biometric authentication successful, proceeding with login...');
      await performLogin(saved.username, saved.password);
    } catch (error) {
      console.error('Biometric login error:', error);
      Alert.alert('Error', `Biometric login failed: ${error.message || 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: spacing['3xl'],
            justifyContent: tablet ? 'center' : 'flex-start',
            paddingVertical: tablet ? spacing['2xl'] : 0,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              width: '100%',
              maxWidth: loginColumnMaxWidth ?? '100%',
              alignSelf: 'center',
              paddingHorizontal: responsivePadding(tablet ? 24 : 32),
              paddingTop: tablet ? spacing.md : spacing.lg,
              paddingBottom: spacing.xl,
            }}
          >
          {/* Header */}
          <View 
            className="items-center"
            style={{ marginBottom: tablet ? spacing['2xl'] : spacing['3xl'] }}
          >
            <Text 
              className="font-bold"
              style={{ 
                color: colors.text,
                fontSize: responsiveFont(tablet ? 28 : 30),
                marginBottom: spacing.xs,
              }}
            >
              hadir.ai
            </Text>
            <Text 
              className="text-center"
              style={{ 
                color: colors.textSecondary,
                fontSize: responsiveFont(tablet ? 15 : 14),
              }}
            >
              Sign in to track your attendance
            </Text>
          </View>

          {/* Login Form */}
          <View 
            className="rounded-2xl shadow-lg"
            style={{ 
              backgroundColor: colors.surface,
              padding: responsivePadding(tablet ? 28 : 24),
              width: '100%',
            }}
          >
            <Text 
              className="font-semibold text-center"
              style={{ 
                color: colors.text,
                fontSize: responsiveFont(tablet ? 19 : 20),
                marginBottom: spacing.lg,
              }}
            >
              Sign In
            </Text>

            {/* Username Input */}
            <View style={{ marginBottom: spacing.md }}>
              <Text 
                className="font-medium"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(14),
                  marginBottom: spacing.xs,
                }}
              >
                Username
              </Text>
              <View 
                className="flex-row items-center rounded-xl"
                style={{
                  backgroundColor: colors.borderLight,
                  paddingHorizontal: responsivePadding(16),
                  paddingVertical: spacing.md,
                  minHeight: inputMinHeight,
                }}
              >
                <Ionicons name="person-outline" size={tablet ? iconSize.md + 2 : iconSize.md} color={colors.textSecondary} />
                <TextInput
                  className="flex-1"
                  placeholder="Enter your username"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    color: colors.text,
                    fontSize: responsiveFont(tablet ? 16 : 14),
                    marginLeft: spacing.md,
                  }}
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={{ marginBottom: spacing.lg }}>
              <Text 
                className="font-medium"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(14),
                  marginBottom: spacing.xs,
                }}
              >
                Password
              </Text>
              <View 
                className="flex-row items-center rounded-xl"
                style={{
                  backgroundColor: colors.borderLight,
                  paddingHorizontal: responsivePadding(16),
                  paddingVertical: spacing.md,
                  minHeight: inputMinHeight,
                }}
              >
                <Ionicons name="lock-closed-outline" size={tablet ? iconSize.md + 2 : iconSize.md} color={colors.textSecondary} />
                <TextInput
                  className="flex-1"
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={handleLogin}
                  returnKeyType="go"
                  style={{
                    color: colors.text,
                    fontSize: responsiveFont(tablet ? 16 : 14),
                    marginLeft: spacing.md,
                  }}
                  placeholderTextColor={colors.textTertiary}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={{ marginLeft: spacing.xs }}
                >
                  <Ionicons 
                    name={showPassword ? "eye-off-outline" : "eye-outline"} 
                    size={iconSize.md} 
                    color={colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Remember Me Checkbox */}
            <View 
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                marginBottom: spacing.md 
              }}
            >
              <TouchableOpacity
                onPress={() => setRememberMe(!rememberMe)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                activeOpacity={0.7}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: rememberMe ? colors.primary : colors.border,
                    backgroundColor: rememberMe ? colors.primary : 'transparent',
                    marginRight: spacing.sm,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  {rememberMe && (
                    <Ionicons name="checkmark" size={14} color="white" />
                  )}
                </View>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: responsiveFont(14),
                  }}
                >
                  Remember Me
                </Text>
              </TouchableOpacity>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: componentSize.buttonHeight / 2,
                alignItems: 'center',
                marginBottom: spacing.md,
                opacity: isLoading ? 0.5 : 1,
                minHeight: tablet ? normalize(50) : componentSize.buttonHeight,
                justifyContent: 'center',
              }}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <Text 
                  style={{ 
                    color: 'white', 
                    fontWeight: '600',
                    fontSize: responsiveFont(16),
                  }}
                >
                  Signing In...
                </Text>
              ) : (
                <Text 
                  style={{ 
                    color: 'white', 
                    fontWeight: '600', 
                    fontSize: responsiveFont(18),
                  }}
                >
                  Sign In
                </Text>
              )}
            </TouchableOpacity>

            {/* Biometric Login Button */}
            {biometricAvailable && hasSavedCredentials && (
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  paddingVertical: spacing.md,
                  marginBottom: spacing.base,
                  borderWidth: 2,
                  borderColor: colors.primary,
                  backgroundColor: 'transparent',
                  opacity: isLoading ? 0.5 : 1,
                }}
                onPress={handleBiometricLogin}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <Ionicons 
                  name={biometricType.toLowerCase().includes('face') ? 'face-recognition' : 'finger-print'} 
                  size={iconSize.lg} 
                  color={colors.primary} 
                  style={{ marginRight: spacing.sm }}
                />
                <Text 
                  style={{ 
                    color: colors.primary, 
                    fontWeight: '600', 
                    fontSize: responsiveFont(16),
                  }}
                >
                  Login with {biometricType}
                </Text>
              </TouchableOpacity>
            )}
          </View>

            {/* Forgot Password Link */}
          <TouchableOpacity
            onPress={() => navigation.navigate('ForgotPassword')}
            style={{ alignItems: 'center', marginTop: spacing.md }}
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: responsiveFont(14),
              }}
            >
              Forgot Password?
            </Text>
          </TouchableOpacity>

          {/* Sign Up Link */}
          <TouchableOpacity
            onPress={() => navigation.navigate('SignUp')}
            style={{ alignItems: 'center', marginTop: spacing.md }}
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: responsiveFont(14),
              }}
            >
              Don't have an account? Sign Up
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate(ROUTES.COMPANY_ONBOARDING)}
            style={{ alignItems: 'center', marginTop: spacing.md }}
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: responsiveFont(14),
                fontWeight: '600',
              }}
            >
              New tenant? Create company & super admin
            </Text>
          </TouchableOpacity>

          {/* Footer: Logo and Trademark - inside ScrollView so never cut off */}
          <View 
            style={{ 
              alignItems: 'center',
              marginTop: spacing['3xl'],
              paddingBottom: spacing.xl,
            }}
          >
            <Logo size="medium" />
            <Trademark position="bottom" style={{ marginTop: spacing.md }} />
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

