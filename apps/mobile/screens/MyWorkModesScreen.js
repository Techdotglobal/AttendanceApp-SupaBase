import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import WorkModeSelfService from '../components/WorkModeSelfService';

export default function MyWorkModesScreen({ route }) {
  const { user: routeUser } = route?.params || {};
  const { user: authUser } = useAuth();
  const { colors } = useTheme();
  const user = authUser ? { ...(routeUser || {}), ...authUser } : routeUser;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="mb-5">
          <Text className="text-2xl font-bold" style={{ color: colors.text }}>My Work Modes</Text>
          <Text className="text-sm mt-1" style={{ color: colors.textSecondary }}>
            View your current work mode and submit requests for approval.
          </Text>
        </View>
        <WorkModeSelfService user={user} />
      </ScrollView>
    </SafeAreaView>
  );
}
