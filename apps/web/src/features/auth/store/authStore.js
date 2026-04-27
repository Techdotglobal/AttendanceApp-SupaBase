import { create } from 'zustand';
import { supabase } from '../../../core/config/supabase';
import { api } from '../../../core/api/client';

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
      const { data } = await api.post('/api/auth/login', { usernameOrEmail, password });
      if (!data.success) throw new Error(data.error || 'Login failed');
      await supabase.auth.signInWithPassword({ email: data.user.email, password });
      set({
        loading: false,
        user: data.user,
      });
      return { success: true, role: data.user.role };
    } catch (error) {
      const message = error?.response?.data?.error || error.message || 'Login failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, loading: false, error: null });
  },
}));
