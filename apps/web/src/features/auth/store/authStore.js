import { create } from 'zustand';
import { supabase } from '../../../core/config/supabase';
import { api } from '../../../core/api/client';
import { apiUrl, IS_API_GATEWAY_CONFIGURED, IS_API_GATEWAY_LOCAL } from '../../../core/config/api';

const extractErrorMessage = (error, fallbackMessage) =>
  error?.response?.data?.error || error?.message || fallbackMessage;

export const useAuthStore = create((set) => ({
  user: null,
  loading: true,
  error: null,
  bootstrap: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return set({ loading: false, user: null });
      const { data } = await supabase.from('users').select('*').eq('uid', session.user.id).single();
      set({
        loading: false,
        user: data
          ? {
              uid: data.uid,
              username: data.username,
              email: data.email,
              role: data.role,
              department: data.department,
            }
          : null,
      });
    } catch (error) {
      set({ loading: false, error: error.message || 'Failed to load session' });
    }
  },
  login: async (usernameOrEmail, password) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post(apiUrl('/api/auth/login'), { usernameOrEmail, password });
      if (!data.success) throw new Error(data.error || 'Login failed');
      await supabase.auth.signInWithPassword({ email: data.user.email, password });
      set({
        loading: false,
        user: data.user,
      });
      return { success: true, role: data.user.role };
    } catch (error) {
      console.error('[authStore] Gateway login failed:', {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
        gatewayConfigured: IS_API_GATEWAY_CONFIGURED,
        gatewayIsLocal: IS_API_GATEWAY_LOCAL,
      });

      const gatewayLikelyUnavailable =
        !IS_API_GATEWAY_CONFIGURED ||
        (!import.meta.env.DEV && IS_API_GATEWAY_LOCAL) ||
        error?.message?.toLowerCase().includes('network') ||
        error?.code === 'ERR_NETWORK';

      if (gatewayLikelyUnavailable) {
        try {
          const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
            email: usernameOrEmail.includes('@') ? usernameOrEmail : usernameOrEmail.toLowerCase(),
            password,
          });

          if (signInError) {
            throw signInError;
          }

          const uid = authData?.user?.id;
          if (!uid) {
            throw new Error('Missing authenticated user id.');
          }

          const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();

          if (profileError) {
            throw profileError;
          }

          const normalizedUser = profile
            ? {
                uid: profile.uid,
                username: profile.username,
                email: profile.email,
                role: profile.role,
                department: profile.department,
              }
            : null;

          set({ loading: false, user: normalizedUser, error: null });
          return { success: true, role: normalizedUser?.role };
        } catch (fallbackError) {
          console.error('[authStore] Supabase fallback login failed:', fallbackError);
          const fallbackMessage = extractErrorMessage(fallbackError, 'Unable to sign in. Please check your credentials.');
          set({ loading: false, error: fallbackMessage });
          return { success: false, error: fallbackMessage };
        }
      }

      const message = extractErrorMessage(error, 'Login failed');
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, loading: false, error: null });
  },
}));
