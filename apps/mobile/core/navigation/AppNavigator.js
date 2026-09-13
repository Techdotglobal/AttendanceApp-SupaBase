// Main App Navigator - Routes users to appropriate navigation stack
import React, { useEffect, useRef, useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthNavigator from './AuthNavigator';
import DrawerNavigator from './DrawerNavigator';
import { ROUTES } from '../../shared/constants/routes';
import { supabase } from '../config/supabase';
import { setPasswordRecoveryActive } from '../auth/passwordRecoveryFlag';

/**
 * The Supabase client is configured with flowType: 'pkce' and
 * detectSessionInUrl: false (there's no browser for it to auto-parse a URL
 * from on React Native), so the recovery link's `code` param must be
 * exchanged for a session explicitly — otherwise ResetPasswordScreen's
 * getSession() check always comes back empty and every legitimate reset
 * link looks "invalid" regardless of how long it waits.
 *
 * exchangeCodeForSession always fires a plain `SIGNED_IN` auth event (it
 * never emits `PASSWORD_RECOVERY` on this manual-exchange path), so the
 * recovery flag is set first — AuthContext checks it to avoid adopting this
 * session as a real login and routing the user into the main app instead of
 * the reset-password screen.
 */
async function exchangeResetPasswordUrl(url) {
  setPasswordRecoveryActive(true);
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) {
      console.warn('[AppNavigator] Reset-password code exchange failed:', error.message);
      setPasswordRecoveryActive(false);
    }
  } catch (error) {
    console.warn('[AppNavigator] Reset-password code exchange threw:', error?.message);
    setPasswordRecoveryActive(false);
  }
}

export default function AppNavigator() {
  const { user, isLoading } = useAuth();
  const { colors, theme } = useTheme();
  const navigationRef = useRef(null);
  const linking = useMemo(
    () => ({
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
    }),
    []
  );

  // Handle deep links for password reset
  useEffect(() => {
    const handleInitialURL = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && initialUrl.includes('reset-password')) {
          console.log('Initial deep link detected:', initialUrl);
          await exchangeResetPasswordUrl(initialUrl);
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
      } catch (error) {
        console.error('Error getting initial URL:', error);
      }
    };

    const handleURL = async (event) => {
      if (event?.url && event.url.includes('reset-password')) {
        console.log('Deep link received while app running:', event.url);
        await exchangeResetPasswordUrl(event.url);
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

    handleInitialURL();
    const subscription = Linking.addEventListener('url', handleURL);

    return () => {
      subscription.remove();
    };
  }, []);

  // Remount NavigationContainer only when the authenticated account changes (uid),
  // or when switching between guest and signed-in. Role/profile/permission refreshes
  // must NOT remount the tree (that caused mid-session screen flicker).
  const navigationKey = user?.uid ? `uid:${user.uid}` : 'guest';

  return (
    <View style={styles.root}>
      <NavigationContainer
        ref={navigationRef}
        key={navigationKey}
        linking={linking}
      >
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {!user ? <AuthNavigator /> : <DrawerNavigator user={user} />}
      </NavigationContainer>

      {isLoading ? (
        <View
          style={[styles.loadingOverlay, { backgroundColor: colors.background + 'CC' }]}
          pointerEvents="auto"
          accessibilityLabel="Loading"
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
});
