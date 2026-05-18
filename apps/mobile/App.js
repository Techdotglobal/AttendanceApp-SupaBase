// IMPORTANT: Import gesture handler FIRST, before any other imports
// This ensures proper initialization for React Navigation Drawer with Reanimated 3
import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Updates from 'expo-updates';

// Core providers
import { AuthProvider } from './core/contexts/AuthContext';
import { ThemeProvider } from './core/contexts/ThemeContext';
import { CompanyProvider } from './core/contexts/CompanyContext';

// Navigation
import AppNavigator from './core/navigation/AppNavigator';

import { clearLegacyDummyEmployeeCache } from './utils/employees';

/**
 * Silently checks for an OTA update on every cold start (production only).
 *
 * Strategy:
 *  - app.json sets checkAutomatically: "ON_LOAD" so expo-updates downloads
 *    the update bundle in the background automatically.
 *  - This function additionally checks, downloads, and prompts the user to
 *    restart — giving them control while ensuring they never miss a fix.
 *  - All errors are swallowed: an update failure must never prevent app launch.
 *  - Skipped entirely in Expo Go / development builds (__DEV__ === true).
 */
async function checkForOTAUpdate() {
  try {
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) return;

    await Updates.fetchUpdateAsync();

    Alert.alert(
      'Update Ready',
      'A new version of Hadir.AI is available. Restart now for the latest improvements.',
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Restart Now',
          onPress: async () => {
            try {
              await Updates.reloadAsync();
            } catch {
              // If reload fails the update will apply on next cold start
            }
          },
        },
      ],
      { cancelable: true }
    );
  } catch (error) {
    // Never let an update check crash the app.
    // Common causes: no network, server unreachable, update already applied.
    if (__DEV__) {
      console.warn('[OTA] Update check skipped:', error?.message);
    }
  }
}

/**
 * Main App Component
 *
 * This is the root component of the application.
 * It sets up the core providers (Theme, Auth) and initializes the navigation.
 *
 * Architecture:
 * - Core providers wrap the entire app
 * - AppNavigator handles routing based on auth state
 * - Features are organized in feature modules
 */
export default function App() {
  useEffect(() => {
    const initializeApp = async () => {
      await clearLegacyDummyEmployeeCache();
    };
    initializeApp();

    // OTA update check — production builds only.
    // expo-updates is a no-op in Expo Go and development clients,
    // but the __DEV__ guard makes intent explicit and avoids noisy warnings.
    if (!__DEV__) {
      checkForOTAUpdate();
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <CompanyProvider>
            <AppNavigator />
          </CompanyProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
