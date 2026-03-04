import React, { useContext, useState } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { wp } from '../../utils/responsive';
import { CompanyContext } from '../../core/contexts/CompanyContext';
import { useTheme } from '../../core/contexts/ThemeContext';

const DEFAULT_LOGO = require('../../assets/logo.png');

export default function Logo({ size = 'medium', style }) {
  const { colors } = useTheme();
  const companyContext = useContext(CompanyContext);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const logoUrl = companyContext?.logoUrl ?? null;
  const loading = companyContext?.loading ?? false;
  const useCustomLogo = !!logoUrl && !remoteFailed;

  const sizes = {
    small: { width: wp(8), height: wp(8) },
    medium: { width: wp(12), height: wp(12) },
    large: { width: wp(20), height: wp(20) },
  };

  const currentSize = sizes[size] || sizes.medium;

  if (loading && !logoUrl) {
    return (
      <View style={[styles.container, style, { width: currentSize.width, height: currentSize.height }]}>
        <ActivityIndicator size="small" color={colors?.primary ?? '#6366f1'} />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Image
        source={useCustomLogo ? { uri: logoUrl } : DEFAULT_LOGO}
        style={[
          styles.logoImage,
          {
            width: currentSize.width,
            height: currentSize.height,
          },
        ]}
        resizeMode="contain"
        onError={() => setRemoteFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
});

