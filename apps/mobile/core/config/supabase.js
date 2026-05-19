// Supabase Configuration
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * Resolve Supabase URL + anon key.
 * EAS/release builds often omit EXPO_PUBLIC_* at bundle time; app.json extra is embedded in the binary.
 */
function resolveSupabaseConfig() {
  const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const envKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey, source: 'env' };
  }

  const extra =
    Constants.expoConfig?.extra ??
    Constants.manifest2?.extra ??
    Constants.manifest?.extra ??
    {};

  if (extra.supabaseUrl && extra.supabaseAnonKey) {
    return {
      url: String(extra.supabaseUrl),
      anonKey: String(extra.supabaseAnonKey),
      source: 'app.json',
    };
  }

  return { url: envUrl, anonKey: envKey, source: 'none' };
}

const resolved = resolveSupabaseConfig();
const supabaseUrl = resolved.url;
const supabaseAnonKey = resolved.anonKey;

export const isSupabaseConfigured = () =>
  Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      !String(supabaseUrl).includes('placeholder') &&
      supabaseAnonKey !== 'placeholder-key'
  );

const isDevelopment = __DEV__;

if (!isSupabaseConfigured()) {
  const errorMessage =
    'Missing Supabase configuration. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env (dev) ' +
    'or extra.supabaseUrl / extra.supabaseAnonKey in app.json (EAS builds).';

  console.error(errorMessage);

  if (isDevelopment) {
    throw new Error('Supabase configuration missing');
  }
}

const AsyncStorageAdapter = {
  getItem: async (key) => {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error('Error getting item from AsyncStorage:', error);
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Error setting item in AsyncStorage:', error);
    }
  },
  removeItem: async (key) => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing item from AsyncStorage:', error);
    }
  },
};

const finalSupabaseUrl = supabaseUrl || 'https://placeholder.supabase.co';
const finalSupabaseAnonKey = supabaseAnonKey || 'placeholder-key';

const supabase = createClient(finalSupabaseUrl, finalSupabaseAnonKey, {
  auth: {
    storage: AsyncStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: {
    headers: {
      'x-client-info': 'hadir-ai-mobile',
    },
  },
});

supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED') {
    console.log('✓ Token refreshed successfully');
  } else if (event === 'SIGNED_OUT') {
    console.log('✓ User signed out');
  }
});

if (isSupabaseConfigured()) {
  console.log(`✓ Supabase client initialized (${resolved.source})`);
} else {
  console.warn('⚠ Supabase client missing credentials — attendance will not sync to the server');
}

export { supabase, supabaseUrl };
