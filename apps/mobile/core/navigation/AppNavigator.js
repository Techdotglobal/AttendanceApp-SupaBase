// Main App Navigator - Routes users to appropriate navigation stack
import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Linking } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthNavigator from './AuthNavigator';
import DrawerNavigator from './DrawerNavigator';
import { ROUTES } from '../../shared/constants/routes';

const Stack = createStackNavigator();

export default function AppNavigator() {
  const { user, isLoading } = useAuth();
  const { colors, theme } = useTheme();
  const navigationRef = useRef(null);
  const linking = {
    prefixes: ['hadirai://'],
    config: {
      screens: {
        Auth: {
          screens: {
            ResetPassword: 'reset-password',
            ForgotPassword: 'forgot-password',
            Login: '',
          },
        },
      },
    },
  };

  // Handle deep links for password reset
  useEffect(() => {
    // Handle initial URL (app opened via deep link)
    const handleInitialURL = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && initialUrl.includes('reset-password')) {
          console.log('Initial deep link detected:', initialUrl);
          // Supabase will automatically process the recovery token from the URL
          // The recovery token is in the URL hash/fragment
          // Wait for Supabase to process it and create a session
          setTimeout(() => {
            if (navigationRef.current) {
              // Navigate to reset password screen
              // Note: If user is logged in, we need to navigate within AuthNavigator
              // The linking config should handle this, but we'll also do it manually
              try {
                navigationRef.current.navigate(ROUTES.RESET_PASSWORD);
              } catch (navError) {
                // If navigation fails, try navigating to auth stack first
                console.log('Direct navigation failed, trying nested navigation');
                navigationRef.current.navigate('Auth', {
                  screen: ROUTES.RESET_PASSWORD,
                });
              }
            }
          }, 800); // Give Supabase time to process the recovery token
        }
      } catch (error) {
        console.error('Error getting initial URL:', error);
      }
    };

    // Handle URL when app is already running
    const handleURL = (event) => {
      if (event?.url && event.url.includes('reset-password')) {
        console.log('Deep link received while app running:', event.url);
        // Supabase will automatically process the recovery token
        setTimeout(() => {
          if (navigationRef.current) {
            try {
              navigationRef.current.navigate(ROUTES.RESET_PASSWORD);
            } catch (navError) {
              console.log('Direct navigation failed, trying nested navigation');
              navigationRef.current.navigate('Auth', {
                screen: ROUTES.RESET_PASSWORD,
              });
            }
          }
        }, 800);
      }
    };

    // Set up listeners
    handleInitialURL();
    const subscription = Linking.addEventListener('url', handleURL);

    return () => {
      subscription.remove();
    };
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // CRITICAL FIX: Use user.uid as key to force navigation reset when user changes
  // This prevents manager screens from rendering with wrong user data
  const navigationKey = user ? `${user.uid}-${user.role}` : 'no-user';

  return (
    <NavigationContainer
      ref={navigationRef}
      key={navigationKey}
      linking={linking}
    >
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {!user ? <AuthNavigator /> : <DrawerNavigator user={user} />}
    </NavigationContainer>
  );
}

