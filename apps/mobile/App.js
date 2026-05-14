// IMPORTANT: Import gesture handler FIRST, before any other imports
// This ensures proper initialization for React Navigation Drawer with Reanimated 3
import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Core providers
import { AuthProvider } from './core/contexts/AuthContext';
import { ThemeProvider } from './core/contexts/ThemeContext';
import { CompanyProvider } from './core/contexts/CompanyContext';

// Navigation
import AppNavigator from './core/navigation/AppNavigator';

import { clearLegacyDummyEmployeeCache } from './utils/employees';

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
    // Initialize app when app starts
    // Supabase handles authentication automatically - no file initialization needed
    const initializeApp = async () => {
      await clearLegacyDummyEmployeeCache();
    };
    initializeApp();
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
