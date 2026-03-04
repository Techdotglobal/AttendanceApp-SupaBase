import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../../core/contexts/ThemeContext';
import { useAuth } from '../../../core/contexts/AuthContext';
import { useCompany } from '../../../core/contexts/CompanyContext';
import { getCompany, updateCompanyLogo } from '../services/companyService';
import { spacing, responsiveFont, responsivePadding, iconSize } from '../../../utils/responsive';

export default function CompanySettingsScreen({ navigation, route }) {
  const { user } = route.params || {};
  const { user: authUser } = useAuth();
  const { colors } = useTheme();
  const { refreshCompany } = useCompany();
  const currentUser = authUser || user;

  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (currentUser?.role !== 'super_admin') {
      navigation.replace('AdminDashboard', { user: currentUser });
      return;
    }
    loadCompany();
  }, [currentUser?.role]);

  const loadCompany = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCompany();
      setCompany(data);
    } catch (e) {
      console.error('[CompanySettingsScreen] loadCompany:', e);
      setError(e.message || 'Failed to load company');
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to change the logo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!company?.id) {
      Alert.alert('Error', 'Company not loaded. Try again.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await updateCompanyLogo(company.id, {
        uri: asset.uri,
        mimeType: asset.mimeType || 'image/png',
        type: asset.mimeType || 'image/png',
      });
      await refreshCompany();
      await loadCompany();
      Alert.alert('Success', 'Company logo updated. It will appear across the app.');
    } catch (e) {
      console.error('[CompanySettingsScreen] update logo:', e);
      setError(e.message || 'Failed to update logo');
      Alert.alert('Error', e.message || 'Failed to update logo. Try again.');
    } finally {
      setUploading(false);
    }
  };

  if (currentUser?.role !== 'super_admin') {
    return null;
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: spacing.md, color: colors.textSecondary, fontSize: responsiveFont(14) }}>
            Loading...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: responsivePadding(24), paddingBottom: spacing['3xl'] }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontSize: responsiveFont(20),
            fontWeight: '600',
            color: colors.text,
            marginBottom: spacing.sm,
          }}
        >
          Company logo
        </Text>
        <Text
          style={{
            fontSize: responsiveFont(14),
            color: colors.textSecondary,
            marginBottom: spacing.lg,
          }}
        >
          Upload a logo to replace the default across the app. Only super admins can change this.
        </Text>

        {error ? (
          <View
            style={{
              backgroundColor: colors.error + '20',
              padding: spacing.md,
              borderRadius: 12,
              marginBottom: spacing.lg,
            }}
          >
            <Text style={{ color: colors.error, fontSize: responsiveFont(14) }}>{error}</Text>
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: responsivePadding(24),
            alignItems: 'center',
            marginBottom: spacing.lg,
          }}
        >
          {company?.logo_url ? (
            <Image
              source={{ uri: company.logo_url }}
              style={{ width: 120, height: 120, borderRadius: 12, marginBottom: spacing.lg }}
              resizeMode="contain"
            />
          ) : (
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 12,
                backgroundColor: colors.borderLight,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: spacing.lg,
              }}
            >
              <Ionicons name="business-outline" size={iconSize['4xl']} color={colors.textTertiary} />
            </View>
          )}

          <TouchableOpacity
            onPress={pickImage}
            disabled={uploading}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.primary,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              borderRadius: 12,
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: spacing.sm }} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={iconSize.lg} color="#fff" style={{ marginRight: spacing.sm }} />
            )}
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: responsiveFont(16) }}>
              {uploading ? 'Uploading...' : company?.logo_url ? 'Change logo' : 'Upload logo'}
            </Text>
          </TouchableOpacity>
        </View>

        {company?.name ? (
          <Text style={{ fontSize: responsiveFont(12), color: colors.textTertiary, textAlign: 'center' }}>
            Company: {company.name}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
