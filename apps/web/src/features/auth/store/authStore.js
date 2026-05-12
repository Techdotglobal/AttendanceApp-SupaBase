import { create } from 'zustand';
import { supabase } from '../../../core/config/supabase';
import { api } from '../../../core/api/client';
import { apiUrl, IS_API_GATEWAY_CONFIGURED, IS_API_GATEWAY_LOCAL } from '../../../core/config/api';
import { shouldSyncTenantMetadata } from '../../../core/auth/tenantClaims';
import { syncTenantMetadataViaGateway } from '../../../core/auth/syncTenantMetadata';
import {
  normalizeEmailForAuth,
  parseLoginIdentifier,
  usernameEqVariants,
} from '../../../core/auth/normalizeLogin';

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
      if (data && shouldSyncTenantMetadata(session, data)) {
        const syncRes = await syncTenantMetadataViaGateway();
        if (!syncRes.success) {
          console.warn('[authStore] bootstrap tenant metadata sync:', syncRes.error);
        }
      }
      set({
        loading: false,
        user: data
          ? {
              uid: data.uid,
              username: data.username,
              email: data.email,
              role: data.role,
              department: data.department,
              companyId: data.company_id != null ? String(data.company_id) : null,
              company_id: data.company_id != null ? String(data.company_id) : null,
              departmentId: data.department_id != null ? String(data.department_id) : null,
            }
          : null,
      });
    } catch (error) {
      set({ loading: false, error: error.message || 'Failed to load session' });
    }
  },
  login: async (usernameOrEmail, password) => {
    const { ident, isEmail } = parseLoginIdentifier(usernameOrEmail);
    set({ loading: true, error: null });
    try {
      if (import.meta.env.DEV) {
        console.log('[authStore] login', { isEmail, identPreview: isEmail ? `${ident.slice(0, 2)}***@${ident.split('@')[1]}` : ident });
      }
      const { data } = await api.post(apiUrl('/api/auth/login'), { usernameOrEmail: ident, password });
      if (!data.success) throw new Error(data.error || 'Login failed');
      const signInEmail = normalizeEmailForAuth(data.user.email);
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
      if (signInErr) {
        console.error('[authStore] signIn after gateway', signInErr.message, signInErr);
        throw signInErr;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const profile = {
        uid: data.user.uid,
        username: data.user.username,
        email: data.user.email,
        role: data.user.role,
        department: data.user.department,
        companyId: data.user.company_id != null ? String(data.user.company_id) : null,
        company_id: data.user.company_id != null ? String(data.user.company_id) : null,
        departmentId: data.user.department_id != null ? String(data.user.department_id) : null,
      };
      if (session && shouldSyncTenantMetadata(session, { ...profile, company_id: profile.companyId, department_id: profile.departmentId, role: profile.role })) {
        const syncRes = await syncTenantMetadataViaGateway();
        if (!syncRes.success) {
          console.warn('[authStore] login tenant sync:', syncRes.error);
        }
      }
      set({
        loading: false,
        user: profile,
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
          let signInEmail;
          if (isEmail) {
            signInEmail = normalizeEmailForAuth(ident);
          } else {
            let row = null;
            for (const u of usernameEqVariants(ident)) {
              const { data: r } = await supabase.from('users').select('email').eq('username', u).maybeSingle();
              if (r?.email) {
                row = r;
                break;
              }
            }
            if (!row?.email) {
              throw new Error('User not found for username');
            }
            signInEmail = normalizeEmailForAuth(row.email);
          }
          if (import.meta.env.DEV) {
            console.log('[authStore] fallback signIn', { isEmail, emailHint: `${signInEmail.slice(0, 2)}***@${signInEmail.split('@')[1]}` });
          }
          const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
            email: signInEmail,
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
                companyId: profile.company_id != null ? String(profile.company_id) : null,
                company_id: profile.company_id != null ? String(profile.company_id) : null,
                departmentId: profile.department_id != null ? String(profile.department_id) : null,
              }
            : null;

          if (normalizedUser && authData?.session) {
            const row = {
              company_id: normalizedUser.companyId,
              department_id: normalizedUser.departmentId,
              role: normalizedUser.role,
            };
            if (shouldSyncTenantMetadata(authData.session, row)) {
              const syncRes = await syncTenantMetadataViaGateway();
              if (!syncRes.success) {
                console.warn('[authStore] fallback login tenant sync:', syncRes.error);
              }
            }
          }

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
