// Authentication Navigation Stack
import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen from '../../screens/LoginScreen';
import SignUpScreen from '../../screens/SignUpScreen';
import ForgotPasswordScreen from '../../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../../screens/ResetPasswordScreen';
import { ROUTES } from '../../shared/constants/routes';

const Stack = createStackNavigator();

export default function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen 
        name={ROUTES.LOGIN} 
        component={LoginScreen}
        options={{ title: 'hadir.ai' }}
      />
      <Stack.Screen 
        name={ROUTES.SIGNUP} 
        component={SignUpScreen}
        options={{ title: 'Sign Up' }}
      />
      <Stack.Screen 
        name={ROUTES.FORGOT_PASSWORD} 
        component={ForgotPasswordScreen}
        options={{ title: 'Forgot Password' }}
      />
      <Stack.Screen 
        name={ROUTES.RESET_PASSWORD} 
        component={ResetPasswordScreen}
        options={{ title: 'Reset Password' }}
      />
    </Stack.Navigator>
  );
}

