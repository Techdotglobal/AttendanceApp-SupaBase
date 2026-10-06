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

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const fetchUserPermissions = async (uid, role) => {
  if (!uid) return { permissions: [], grants: [] };
  const canonical = await supabase
    .from('permission_grants')
    .select('permission_key, granted, scope_type, department_id')
    .eq('principal_uid', uid)
    .eq('granted', true);
  if (!canonical.error && canonical.data?.length) {
    return {
      permissions: [...new Set(canonical.data.map((row) => row.permission_key))],
      grants: canonical.data,
    };
  }
  if (role !== 'manager') return { permissions: [], grants: [] };
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('permission_key, granted')
    .eq('manager_uid', uid);
  if (error) {
    console.warn('[authStore] permissions load failed:', error.message);
    return { permissions: [], grants: [] };
  }
  const granted = (data || []).filter((row) => row.granted === true).map((row) => ({
    permission_key: row.permission_key,
    granted: true,
    scope_type: 'DEPARTMENT',
    department_id: null,
  }));
  return { permissions: granted.map((row) => row.permission_key), grants: granted };
};

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
      const access = data ? await fetchUserPermissions(data.uid, normalizeRole(data.role)) : { permissions: [], grants: [] };
      set({
        loading: false,
        user: data
          ? {
              uid: data.uid,
              username: data.username,
              email: data.email,
              role: normalizeRole(data.role),
              department: data.department,
              companyId: data.company_id != null ? String(data.company_id) : null,
              company_id: data.company_id != null ? String(data.company_id) : null,
              departmentId: data.department_id != null ? String(data.department_id) : null,
              permissions: access.permissions,
              grants: access.grants,
              organizationRoleId: data.organization_role_id || null,
              authorizationVersion: data.authorization_version || 1,
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
      // Keep gateway attempt short — if Coolify/API is down, fall through to Supabase quickly.
      const { data } = await api.post(
        apiUrl('/api/auth/login'),
        { usernameOrEmail: ident, password },
        { timeout: 5000 }
      );
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
        role: normalizeRole(data.user.role),
        department: data.user.department,
        companyId: data.user.company_id != null ? String(data.user.company_id) : null,
        company_id: data.user.company_id != null ? String(data.user.company_id) : null,
        departmentId: data.user.department_id != null ? String(data.user.department_id) : null,
        permissions: data.user.permissions || [],
        grants: data.user.grants || [],
        organizationRoleId: data.user.organization_role_id || null,
        authorizationVersion: data.user.authorization_version || 1,
      };
      if (session && shouldSyncTenantMetadata(session, { ...profile, company_id: profile.companyId, department: profile.department, role: profile.role })) {
        const syncRes = await syncTenantMetadataViaGateway();
        if (!syncRes.success) {
          console.warn('[authStore] login tenant sync:', syncRes.error);
        }
      }
      set({
        loading: false,
        user: profile,
      });
      return { success: true, role: normalizeRole(data.user.role) };
    } catch (error) {
      console.error('[authStore] Gateway login failed:', {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
        gatewayConfigured: IS_API_GATEWAY_CONFIGURED,
        gatewayIsLocal: IS_API_GATEWAY_LOCAL,
      });

      const errMsg = String(error?.message || '').toLowerCase();
      const gatewayLikelyUnavailable =
        !IS_API_GATEWAY_CONFIGURED ||
        (!import.meta.env.DEV && IS_API_GATEWAY_LOCAL) ||
        errMsg.includes('network') ||
        errMsg.includes('timeout') ||
        error?.code === 'ERR_NETWORK' ||
        error?.code === 'ECONNABORTED' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNREFUSED';

      if (gatewayLikelyUnavailable) {
        try {
          let signInEmail;
          if (isEmail) {
            signInEmail = normalizeEmailForAuth(ident);
          } else {
            let row = null;
            const { data: normalizedRow } = await supabase
              .from('users')
              .select('email')
              .eq('normalized_username', ident.toLowerCase())
              .maybeSingle();
            row = normalizedRow;
            for (const u of usernameEqVariants(ident)) {
              if (row?.email) break;
              const { data: r } = await supabase.from('users').select('email').eq('username', u).maybeSingle();
              if (r?.email) row = r;
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
                role: normalizeRole(profile.role),
                department: profile.department,
                companyId: profile.company_id != null ? String(profile.company_id) : null,
                company_id: profile.company_id != null ? String(profile.company_id) : null,
                departmentId: profile.department_id != null ? String(profile.department_id) : null,
                ...(await fetchUserPermissions(profile.uid, normalizeRole(profile.role))),
              }
            : null;

          if (normalizedUser && authData?.session) {
            const row = {
              company_id: normalizedUser.companyId,
              department: normalizedUser.department,
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
  refreshPermissions: async () => {
    const state = useAuthStore.getState();
    if (!state.user?.uid) return;

    const samePermissions = (nextPermissions = [], nextRole = state.user.role, nextGrants = state.user.grants || []) => {
      const current = state.user.permissions || [];
      if ((nextRole || state.user.role) !== state.user.role) return false;
      if (current.length !== nextPermissions.length) return false;
      for (let i = 0; i < current.length; i += 1) {
        if (current[i] !== nextPermissions[i]) return false;
      }
      return JSON.stringify(state.user.grants || []) === JSON.stringify(nextGrants || []);
    };

    try {
      const { data } = await api.get(apiUrl('/api/auth/me/permissions'));
      if (data?.success && data?.data) {
        const permissions = data.data.permissions || [];
        const grants = data.data.grants || [];
        const role = normalizeRole(data.data.role || state.user.role);
        // Avoid a new user object when nothing changed — DashboardPage keys
        // loadDashboard off `user`, and a noop refresh was forcing a full reload.
        if (samePermissions(permissions, role, grants)) return;
        set({
          user: {
            ...state.user,
            permissions,
            grants,
            role,
            authorizationVersion: data.data.authorization_version || state.user.authorizationVersion || 1,
          },
        });
        return;
      }
    } catch {
      /* fallback below */
    }
    const access = await fetchUserPermissions(state.user.uid, state.user.role);
    if (samePermissions(access.permissions, state.user.role, access.grants)) return;
    set({ user: { ...state.user, permissions: access.permissions, grants: access.grants } });
  },
}));
