import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { responsiveFont, spacing } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

export default function Trademark({ position = 'bottom', style }) {
  const { colors } = useTheme();

  return (
    <View style={[
      styles.container,
      position === 'top' && styles.topPosition,
      position === 'bottom' && styles.bottomPosition,
      position === 'inline' && styles.inlinePosition,
      style
    ]}>
      <Text style={[styles.text, { color: colors.textSecondary, fontSize: responsiveFont(10) }]}>
        Powered by TechDotGlobal ©
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  topPosition: {
    marginTop: spacing.base,
    marginBottom: spacing.sm,
  },
  bottomPosition: {
    marginTop: spacing.sm,
    marginBottom: spacing.base,
  },
  inlinePosition: {
    marginVertical: spacing.xs,
  },
  text: {
    textAlign: 'center',
    opacity: 0.7,
  },
});

