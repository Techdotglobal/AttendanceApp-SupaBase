import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { API_GATEWAY_URL } from '../core/config/api';
import { spacing, responsiveFont, responsivePadding } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';

export default function CompanyOnboardingScreen({ navigation }) {
  const { colors } = useTheme();
  const [statusLoading, setStatusLoading] = useState(true);
  const [requiresKey, setRequiresKey] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [superAdminName, setSuperAdminName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [onboardingKey, setOnboardingKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  const base = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL.replace(/\/+$/, '') : '';

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setError('');
    if (!base) {
      setError('API gateway URL is not configured (app.json extra.apiGatewayUrl).');
      setStatusLoading(false);
      return;
    }
    try {
      const res = await fetch(`${base}/api/auth/onboarding-status`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not load onboarding status');
      }
      setRequiresKey(Boolean(data.requiresOnboardingKey));
    } catch (e) {
      setError(e.message || 'Network error');
    } finally {
      setStatusLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const submit = async () => {
    setError('');
    setSuccess(null);
    if (!base) {
      setError('API gateway URL is not configured.');
      return;
    }
    if (requiresKey && !onboardingKey.trim()) {
      setError('Onboarding key is required for additional companies.');
      return;
    }
    if (!companyName.trim() || !superAdminName.trim() || !username.trim() || !email.trim() || !password) {
      setError('Please fill all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (requiresKey && onboardingKey.trim()) {
        headers['X-Onboarding-Key'] = onboardingKey.trim();
      }
      const res = await fetch(`${base}/api/auth/onboard-company`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: companyName.trim(),
          superAdminName: superAdminName.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
      }
      setSuccess(data);
      setPassword('');
    } catch (e) {
      setError(e.message || 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: responsivePadding(20), paddingBottom: spacing['3xl'] }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <Logo size="medium" />
          </View>
          <Text style={{ fontSize: responsiveFont(22), fontWeight: '700', color: colors.text, marginBottom: spacing.sm }}>
            Company ready
          </Text>
          <Text style={{ fontSize: responsiveFont(15), color: colors.textSecondary, marginBottom: spacing.lg }}>
            {success.company?.name} is set up. Sign in as {success.user?.username} with your password.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={{
              backgroundColor: colors.primary,
              paddingVertical: spacing.md,
              borderRadius: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: responsiveFont(16) }}>Go to sign in</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: responsivePadding(20), paddingBottom: spacing['3xl'] }}
        >
          <View style={{ alignItems: 'center', marginBottom: spacing.md }}>
            <Logo size="medium" />
          </View>
          <Text style={{ fontSize: responsiveFont(22), fontWeight: '700', color: colors.text, marginBottom: spacing.xs }}>
            Create company
          </Text>
          <Text style={{ fontSize: responsiveFont(14), color: colors.textSecondary, marginBottom: spacing.lg }}>
            New tenant: Management department + super admin.
          </Text>

          {statusLoading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textSecondary }}>Checking onboarding…</Text>
            </View>
          )}

          {requiresKey && !statusLoading && (
            <TextInput
              placeholder="Onboarding key (server secret)"
              placeholderTextColor={colors.textSecondary}
              value={onboardingKey}
              onChangeText={setOnboardingKey}
              autoCapitalize="none"
              secureTextEntry
              style={{
                borderWidth: 1,
                borderColor: colors.border || '#ccc',
                borderRadius: 10,
                padding: spacing.md,
                marginBottom: spacing.md,
                color: colors.text,
              }}
            />
          )}

          <TextInput
            placeholder="Company name"
            placeholderTextColor={colors.textSecondary}
            value={companyName}
            onChangeText={setCompanyName}
            style={{
              borderWidth: 1,
              borderColor: colors.border || '#ccc',
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.md,
              color: colors.text,
            }}
          />
          <TextInput
            placeholder="Super admin full name"
            placeholderTextColor={colors.textSecondary}
            value={superAdminName}
            onChangeText={setSuperAdminName}
            style={{
              borderWidth: 1,
              borderColor: colors.border || '#ccc',
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.md,
              color: colors.text,
            }}
          />
          <TextInput
            placeholder="Username"
            placeholderTextColor={colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: colors.border || '#ccc',
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.md,
              color: colors.text,
            }}
          />
          <TextInput
            placeholder="Email"
            placeholderTextColor={colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              borderWidth: 1,
              borderColor: colors.border || '#ccc',
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.md,
              color: colors.text,
            }}
          />
          <TextInput
            placeholder="Password (min 8)"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={{
              borderWidth: 1,
              borderColor: colors.border || '#ccc',
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.md,
              color: colors.text,
            }}
          />

          {error ? (
            <Text style={{ color: '#b91c1c', marginBottom: spacing.md, fontSize: responsiveFont(14) }}>{error}</Text>
          ) : null}

          <TouchableOpacity
            onPress={submit}
            disabled={submitting || statusLoading}
            style={{
              backgroundColor: colors.primary,
              paddingVertical: spacing.md,
              borderRadius: 12,
              alignItems: 'center',
              opacity: submitting || statusLoading ? 0.6 : 1,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: responsiveFont(16) }}>
                Create company & super admin
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: responsiveFont(15) }}>Back to sign in</Text>
          </TouchableOpacity>

          <View style={{ marginTop: spacing['3xl'], alignItems: 'center' }}>
            <Trademark position="bottom" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
