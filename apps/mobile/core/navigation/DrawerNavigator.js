// Drawer Navigator - Reanimated 3/4 Compatible Implementation
// 
// ROOT CAUSE: @react-navigation/drawer v6.7.2 internally tries to use
// useLegacyImplementation prop when detecting Reanimated 3/4, but Reanimated 3/4
// doesn't support this prop. This causes a runtime error.
//
// SOLUTION: Use drawerType: 'front' which forces modern Reanimated implementation
// and prevents the drawer from attempting to use legacy APIs.
import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTheme } from '../contexts/ThemeContext';
import CustomDrawer from '../../shared/components/CustomDrawer';
import MainNavigator from './MainNavigator';
import { isTablet } from '../../utils/responsive';

const Drawer = createDrawerNavigator();

export default function DrawerNavigator({ user }) {
  const { colors } = useTheme();
  const tablet = isTablet();

  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        // CRITICAL: 'front' drawer type uses modern Reanimated 3/4 implementation
        // This prevents @react-navigation/drawer from trying to use useLegacyImplementation
        drawerType: 'front',
        drawerPosition: 'left',
        drawerStyle: {
          backgroundColor: colors.surface,
          width: tablet ? 320 : 280,
        },
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor: colors.textSecondary,
        overlayColor: 'rgba(0, 0, 0, 0.5)',
        swipeEnabled: true,
      }}
    >
      <Drawer.Screen 
        name="MainStack" 
        options={{ drawerLabel: 'Main' }}
      >
        {(props) => <MainNavigator user={user} {...props} />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
}
