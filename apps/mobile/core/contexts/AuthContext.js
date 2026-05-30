/**
 * AuthProvider loads the signed-in user from public.users (canonical profile + tenant),
 * keeps JWT user_metadata aligned with that row via gateway sync, and exposes one `user`
 * object on context. In-memory profile is preserved on transient read failures so roles
 * are never silently downgraded.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase';
import { getTenantClaimsFromSession } from '../auth/tenantClaims';
import { normalizeEmailForAuth } from '../auth/normalizeLogin';
import { requireValidCompanyId } from '../tenant/tenantScope';
import { tenantDiagLog } from '../debug/tenantRuntimeDiag';
import { subscribeToNotifications } from '../../features/notifications/services/realtimeNotifications';
import { subscribeToAttendance } from '../../features/attendance/services/realtimeAttendance';
import { subscribeToWorkModeChanges } from '../../features/employees/services/realtimeEmployees';
import { startLocationMonitoring, stopLocationMonitoring } from '../../features/geofencing/services/locationMonitoringService';

const AuthContext = createContext();

/**
 * Emergency hydration when public.users row is temporarily unreadable.
 * Never invent role "employee" or tenant — that caused super_admin downgrades after backgrounding.
 * Sources: (1) last good profile same uid (2) JWT user_metadata with valid UUID company_id + role.
 */
function resolveSessionFallbackUser(authUser, lastGood) {
  if (!authUser) return null;
  const id = authUser.id;
  if (lastGood && String(lastGood.uid) === String(id)) {
    // AUTH-2: Discard lastGood if JWT company_id has drifted (tenant switch / re-assignment).
    // Trusting a stale company_id would scope subsequent DB queries to the wrong tenant.
    const jwtCompanyId = authUser.user_metadata?.company_id != null
      ? String(authUser.user_metadata.company_id)
      : null;
    if (jwtCompanyId && jwtCompanyId !== lastGood.companyId) {
      console.warn('[AUTH_CONTEXT] resolveSessionFallbackUser: JWT company_id drifted — discarding lastGood', {
        lastGood: lastGood.companyId,
        jwt: jwtCompanyId,
      });
      // Fall through to JWT-only hydration below
    } else {
      return { ...lastGood, email: authUser.email ?? lastGood.email };
    }
  }
  const meta = authUser.user_metadata || {};
  const role = meta.role != null ? String(meta.role).trim() : '';
  const companyRaw = meta.company_id != null ? String(meta.company_id) : null;
  const companyId = requireValidCompanyId(companyRaw, 'jwt_fallback');
  const username =
    meta.username != null ? String(meta.username) : authUser.email?.split('@')[0] || 'user';
  if (role && companyId) {
    return {
      uid: id,
      email: authUser.email,
      username,
      role,
      companyId,
      departmentId:
        typeof meta.department === 'string' && meta.department.trim()
          ? meta.department.trim()
          : meta.department_id != null
            ? String(meta.department_id)
            : null,
      name: meta.name || username,
      department: typeof meta.department === 'string' ? meta.department : '',
      position: typeof meta.position === 'string' ? meta.position : '',
      workMode: meta.work_mode || 'in_office',
      id,
    };
  }
  return null;
}

export function AuthProvider({ children }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  /** Monotonic id: only the latest loadUserData may commit to React state (avoids stale overwrites). */
  const loadUserDataSeqRef = useRef(0);
  const lastGoodProfileRef = useRef(null); // Last successful profile (same uid) for resilient refresh
  const realtimeSubscriptionsRef = useRef({
    notifications: null,
    attendance: null,
    workMode: null,
  });

  useEffect(() => {
    // Eagerly catch stale/invalid refresh tokens before INITIAL_SESSION fires.
    // loadUserData is NOT called here — INITIAL_SESSION handles all initial hydration.
    supabase.auth.getSession()
      .then(({ error }) => {
        if (error?.message?.includes('Refresh Token') || error?.message?.includes('refresh_token')) {
          console.log('[AUTH_CONTEXT] Stale refresh token detected, clearing session...');
          supabase.auth.signOut().catch(console.error);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('[AUTH_CONTEXT] getSession check error:', err);
        setIsLoading(false);
      });

    // Defer profile reload so auth API calls (e.g. signInWithPassword during password
    // change) are not blocked waiting for this listener to finish — avoids deadlocks.
    const scheduleLoadUserData = (userId) => {
      setTimeout(() => {
        void loadUserData(userId);
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session ? 'has session' : 'no session');

      if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id);
        } else {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
        if (session?.user) {
          scheduleLoadUserData(session.user.id);
        }
      } else if (event === 'SIGNED_OUT') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id);
        } else {
          setUser(null);
          setIsLoading(false);
        }
      } else if (event === 'USER_UPDATED') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        scheduleLoadUserData(session.user.id);
      } else if (!session) {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Set up realtime subscriptions when user is logged in
  useEffect(() => {
    // Only subscribe if user is available and has uid
    if (!user || !user.uid) {
      // Clean up any existing subscriptions if user is logged out
      if (realtimeSubscriptionsRef.current.notifications) {
        console.log('[AUTH_CONTEXT] Cleaning up notifications subscription (user logged out)');
        realtimeSubscriptionsRef.current.notifications.unsubscribe();
        realtimeSubscriptionsRef.current.notifications = null;
      }
      if (realtimeSubscriptionsRef.current.attendance) {
        console.log('[AUTH_CONTEXT] Cleaning up attendance subscription (user logged out)');
        realtimeSubscriptionsRef.current.attendance.unsubscribe();
        realtimeSubscriptionsRef.current.attendance = null;
      }
      if (realtimeSubscriptionsRef.current.workMode) {
        console.log('[AUTH_CONTEXT] Cleaning up work mode subscription (user logged out)');
        realtimeSubscriptionsRef.current.workMode.unsubscribe();
        realtimeSubscriptionsRef.current.workMode = null;
      }
      // Stop location monitoring
      stopLocationMonitoring();
      return;
    }

    console.log('[AUTH_CONTEXT] Setting up realtime subscriptions for user:', user.username);

    // 1. Subscribe to notifications
    try {
      if (!realtimeSubscriptionsRef.current.notifications) {
        const notificationsSub = subscribeToNotifications(
          user.uid,
          user.username,
          (data) => {
            // Notification received callback
            // The notification is already stored in AsyncStorage by the service
            // This callback can be used to trigger UI updates if needed
            console.log('[AUTH_CONTEXT] Notification received via realtime:', data.notification.id);
            // You can emit an event or update a context here if needed
          },
          (error) => {
            console.error('[AUTH_CONTEXT] Notifications subscription error:', error);
          }
        );
        realtimeSubscriptionsRef.current.notifications = notificationsSub;
      }
    } catch (error) {
      console.error('[AUTH_CONTEXT] Error setting up notifications subscription:', error);
    }

    // 2. Subscribe to attendance records
    try {
      if (!realtimeSubscriptionsRef.current.attendance) {
        const attendanceSub = subscribeToAttendance(
          user,
          (data) => {
            // Attendance change callback
            console.log('[AUTH_CONTEXT] Attendance change via realtime:', data.type, data.record.id);
            // You can emit an event or update a context here if needed
          },
          (error) => {
            console.error('[AUTH_CONTEXT] Attendance subscription error:', error);
          }
        );
        realtimeSubscriptionsRef.current.attendance = attendanceSub;
      }
    } catch (error) {
      console.error('[AUTH_CONTEXT] Error setting up attendance subscription:', error);
    }

    // 3. Subscribe to work mode changes
    try {
      if (!realtimeSubscriptionsRef.current.workMode) {
        const workModeSub = subscribeToWorkModeChanges(
          user,
          (data) => {
            // Work mode change callback
            console.log('[AUTH_CONTEXT] Work mode change via realtime:', data.username, data.oldWorkMode, '->', data.newWorkMode);
            // You can emit an event or update a context here if needed
          },
          (error) => {
            console.error('[AUTH_CONTEXT] Work mode subscription error:', error);
          }
        );
        realtimeSubscriptionsRef.current.workMode = workModeSub;
      }
    } catch (error) {
      console.error('[AUTH_CONTEXT] Error setting up work mode subscription:', error);
    }

    // 4. Start location monitoring (for automatic checkout)
    (async () => {
      try {
        console.log('[AUTH_CONTEXT] Starting location monitoring for user:', user.username);
        await startLocationMonitoring(user);
      } catch (error) {
        console.error('[AUTH_CONTEXT] Error starting location monitoring:', error);
      }
    })();

    // Cleanup function: unsubscribe when user changes or component unmounts
    return () => {
      console.log('[AUTH_CONTEXT] Cleaning up realtime subscriptions');
      if (realtimeSubscriptionsRef.current.notifications) {
        realtimeSubscriptionsRef.current.notifications.unsubscribe();
        realtimeSubscriptionsRef.current.notifications = null;
      }
      if (realtimeSubscriptionsRef.current.attendance) {
        realtimeSubscriptionsRef.current.attendance.unsubscribe();
        realtimeSubscriptionsRef.current.attendance = null;
      }
      if (realtimeSubscriptionsRef.current.workMode) {
        realtimeSubscriptionsRef.current.workMode.unsubscribe();
        realtimeSubscriptionsRef.current.workMode = null;
      }
      // Stop location monitoring
      stopLocationMonitoring();
    };
  }, [user]); // Re-run when user changes

  // ATT-3: Drain offline attendance queue when app comes back to foreground.
  useEffect(() => {
    if (!user?.companyId) return;
    const handleAppStateChange = (nextState) => {
      if (nextState === 'active') {
        import('../../utils/storage').then(({ syncOfflineAttendanceQueue }) => {
          syncOfflineAttendanceQueue(user.companyId).catch((err) => {
            console.warn('[AUTH_CONTEXT] syncOfflineAttendanceQueue error:', err?.message || err);
          });
        });
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [user?.companyId]);

  // Reload profile from public.users when app returns to foreground (picks up admin role/department changes).
  useEffect(() => {
    if (!user?.uid) return;
    const handleAppStateChange = (nextState) => {
      if (nextState === 'active') {
        void loadUserData(user.uid);
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [user?.uid]);

  const loadUserData = async (userId) => {
    const seq = ++loadUserDataSeqRef.current;
    const isStale = () => seq !== loadUserDataSeqRef.current;

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (isStale()) {
        return;
      }
      if (sessionError) {
        console.error('Session error in loadUserData:', sessionError);
        if (sessionError.message?.includes('Refresh Token') || sessionError.message?.includes('refresh_token')) {
          console.log('Invalid refresh token, signing out...');
          await supabase.auth.signOut();
          lastGoodProfileRef.current = null;
          if (!isStale()) {
            setUser(null);
            setIsLoading(false);
          }
          return;
        }
      }

      if (!session) {
        console.log('No active session');
        if (!isStale()) {
          lastGoodProfileRef.current = null;
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      if (session.user.id !== userId) {
        console.warn('[AUTH_CONTEXT] Session userId mismatch:', {
          expected: userId,
          actual: session.user.id,
        });
        if (!isStale()) {
          setIsLoading(false);
        }
        return;
      }

      const authUser = session.user;

      tenantDiagLog('AuthContext.loadUserData.start', {
        sessionUid: authUser?.id,
        jwtSnapshot: getTenantClaimsFromSession(session),
      });

      let { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('uid', userId)
        .maybeSingle();

      if (userError || !userData) {
        console.log('Query by uid failed, trying by email...', userError?.message);
        if (authUser?.email) {
          const canonEmail = normalizeEmailForAuth(authUser.email);
          const { data: userDataByEmail, error: emailError } = await supabase
            .from('users')
            .select('*')
            .eq('email', canonEmail)
            .maybeSingle();

          if (!emailError && userDataByEmail) {
            console.log('Found user by email:', userDataByEmail.username);
            userData = userDataByEmail;
            userError = null;
          } else {
            console.error('Error loading user data by email:', emailError);
          }
        }
      }

      if (userError || !userData) {
        console.error('Error loading user data:', userError);
        if (isStale()) {
          return;
        }

        if (authUser) {
          const fallback = resolveSessionFallbackUser(authUser, lastGoodProfileRef.current);
          if (fallback) {
            console.warn(
              '[AUTH_CONTEXT] No public.users row; using last good profile or complete JWT tenant claims only'
            );
            const meta = authUser.user_metadata || {};
            const companyIdSource =
              lastGoodProfileRef.current &&
              String(lastGoodProfileRef.current.uid) === String(authUser.id)
                ? 'lastGoodProfileRef_same_uid'
                : meta.role && meta.company_id
                  ? 'jwt_user_metadata'
                  : 'unknown';
            tenantDiagLog('AuthContext.loadUserData.fallback_no_users_row', {
              sessionUid: authUser.id,
              companyIdSource,
              resolvedRole: fallback.role,
              resolvedCompanyId: fallback.companyId,
              jwtSnapshot: getTenantClaimsFromSession(session),
              mergedUser: fallback,
            });
            lastGoodProfileRef.current = fallback;
            setUser(fallback);
            tenantDiagLog('AuthContext.loadUserData.setUser_applied', {
              branch: 'fallback_no_db_row',
              mergedUser: fallback,
            });
          } else {
            console.error(
              '[AUTH_CONTEXT] Cannot hydrate profile: no public.users row and JWT missing role/company_id. Preserving last in-memory profile if same uid.'
            );
            const keep =
              lastGoodProfileRef.current && String(lastGoodProfileRef.current.uid) === String(authUser.id)
                ? lastGoodProfileRef.current
                : null;
            if (keep) {
              tenantDiagLog('AuthContext.loadUserData.preserve_lastGood_no_fallback', {
                sessionUid: authUser.id,
                mergedUser: keep,
              });
              setUser({ ...keep, email: authUser.email ?? keep.email });
            } else {
              setUser(null);
            }
          }
        }
        if (!isStale()) {
          setIsLoading(false);
        }
        return;
      }

      if (isStale()) {
        return;
      }

      try {
        const { shouldSyncTenantMetadata, getTenantClaimsFromSession, tenantClaimsMatchUserRow } = await import(
          '../auth/tenantClaims'
        );
        const { syncTenantMetadataViaGateway } = await import('../auth/syncTenantMetadata');

        let sessionForClaims = session;
        if (shouldSyncTenantMetadata(session, userData)) {
          console.log('[AUTH_CONTEXT] JWT tenant metadata missing or stale vs users row; syncing via gateway...');
          const syncResult = await syncTenantMetadataViaGateway();
          if (!syncResult.success) {
            console.error('[AUTH_CONTEXT] Tenant metadata sync failed:', syncResult.error);
          }
          const { data: { session: refreshed }, error: refreshReadError } = await supabase.auth.getSession();
          if (refreshReadError) {
            console.warn('[AUTH_CONTEXT] getSession after sync:', refreshReadError.message);
          }
          if (refreshed) {
            sessionForClaims = refreshed;
          }
        }

        const claims = getTenantClaimsFromSession(sessionForClaims);
        if (!tenantClaimsMatchUserRow(sessionForClaims, userData)) {
          console.error('[AUTH_CONTEXT] Tenant JWT mismatched users row after sync attempt', {
            jwt: claims,
            db: {
              company_id: userData.company_id,
              role: userData.role,
              department: userData.department,
            },
          });
        }
      } catch (syncBlockError) {
        console.error('[AUTH_CONTEXT] Tenant metadata sync block error:', syncBlockError?.message || syncBlockError);
      }

      if (isStale()) {
        return;
      }

      if (isStale()) {
        return;
      }

      const dbRole = userData.role != null ? String(userData.role).trim() : '';
      if (!dbRole) {
        console.error('[AUTH_CONTEXT] public.users row has empty role — refusing to fabricate role', userId);
        const keep =
          lastGoodProfileRef.current && String(lastGoodProfileRef.current.uid) === String(userId)
            ? lastGoodProfileRef.current
            : null;
        if (keep) {
          setUser({ ...keep, email: authUser?.email ?? keep.email });
        }
        setIsLoading(false);
        return;
      }

      const companyIdStr = userData.company_id != null ? String(userData.company_id) : null;
      if (!requireValidCompanyId(companyIdStr, 'loadUserData')) {
        console.error('[AUTH_CONTEXT] public.users row has invalid company_id — check tenant data', userId);
      }

      const combinedUser = {
        uid: userId,
        email: authUser?.email || userData.email,
        username: userData.username || authUser?.email?.split('@')[0],
        role: dbRole,
        companyId: companyIdStr,
        departmentId: userData.department_id != null ? String(userData.department_id) : null,
        name: userData.name || authUser?.user_metadata?.name,
        department: userData.department || '',
        position: userData.position || '',
        workMode: userData.work_mode || 'in_office',
        hireDate: userData.hire_date,
        id: userId,
      };

      {
        const { data: { session: sessDiag } } = await supabase.auth.getSession();
        const jwtSnap = getTenantClaimsFromSession(sessDiag);
        tenantDiagLog('AuthContext.loadUserData.success', {
          sessionUid: userId,
          companyIdSource: 'public.users_row',
          dbRow: {
            username: userData.username,
            role: userData.role,
            company_id: userData.company_id != null ? String(userData.company_id) : null,
            is_active: userData.is_active,
            department: userData.department,
          },
          jwtSnapshot: jwtSnap,
          resolvedRole: combinedUser.role,
          resolvedCompanyId: combinedUser.companyId,
          mergedUser: combinedUser,
        });
      }

      if (!isStale()) {
        lastGoodProfileRef.current = combinedUser;
        setUser(combinedUser);
        tenantDiagLog('AuthContext.loadUserData.setUser_applied', {
          branch: 'public_users_merge',
          mergedUser: combinedUser,
        });
      }
    } catch (error) {
      if (isStale()) {
        return;
      }
      console.error('Error loading user data:', error);

      if (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token') || error.message?.includes('Invalid Refresh Token')) {
        console.log('Refresh token error detected, signing out...');
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('Error signing out:', signOutError);
        }
        if (!isStale()) {
          lastGoodProfileRef.current = null;
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const { data: { session: fallbackSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !fallbackSession || !fallbackSession.user) {
          console.error('Error getting session in catch:', sessionError);
          if (sessionError?.message?.includes('Refresh Token') || sessionError?.message?.includes('refresh_token')) {
            await supabase.auth.signOut();
          }
          if (!isStale()) {
            lastGoodProfileRef.current = null;
            setUser(null);
          }
        } else if (!isStale()) {
          const fb = resolveSessionFallbackUser(fallbackSession.user, lastGoodProfileRef.current);
          if (fb) {
            const meta = fallbackSession.user.user_metadata || {};
            const companyIdSource =
              lastGoodProfileRef.current &&
              String(lastGoodProfileRef.current.uid) === String(fallbackSession.user.id)
                ? 'lastGoodProfileRef_same_uid'
                : meta.role && meta.company_id
                  ? 'jwt_user_metadata'
                  : 'unknown';
            tenantDiagLog('AuthContext.loadUserData.catch_fallback', {
              sessionUid: fallbackSession.user.id,
              companyIdSource,
              jwtSnapshot: getTenantClaimsFromSession(fallbackSession),
              resolvedRole: fb.role,
              resolvedCompanyId: fb.companyId,
              mergedUser: fb,
            });
            lastGoodProfileRef.current = fb;
            setUser(fb);
            tenantDiagLog('AuthContext.loadUserData.setUser_applied', {
              branch: 'catch_resolveSessionFallback',
              mergedUser: fb,
            });
          } else {
            const keep =
              lastGoodProfileRef.current &&
              String(lastGoodProfileRef.current.uid) === String(fallbackSession.user.id)
                ? lastGoodProfileRef.current
                : null;
            if (keep) {
              tenantDiagLog('AuthContext.loadUserData.catch_preserve_lastGood', { sessionUid: fallbackSession.user.id });
              setUser({ ...keep, email: fallbackSession.user.email ?? keep.email });
            } else {
              setUser(null);
            }
          }
        }
      } catch (getSessionError) {
        console.error('Error in getSession fallback:', getSessionError);
        if (!isStale()) {
          lastGoodProfileRef.current = null;
          setUser(null);
        }
      }
    } finally {
      if (!isStale()) {
        setIsLoading(false);
      }
    }
  };

  const handleLogin = async (userData) => {
    if (userData?.uid) {
      lastGoodProfileRef.current = { ...userData };
    }
    tenantDiagLog('AuthContext.handleLogin', {
      uid: userData?.uid,
      role: userData?.role,
      companyId: userData?.companyId ?? userData?.company_id,
      username: userData?.username,
    });
    setUser(userData);
    if (userData?.uid) {
      await loadUserData(userData.uid);
    }
  };

  const handleLogout = async () => {
    try {
      console.log('[AUTH_CONTEXT] Logout started');
      
      // 1. Unsubscribe from all realtime channels FIRST
      console.log('[AUTH_CONTEXT] Unsubscribing from realtime channels...');
      if (realtimeSubscriptionsRef.current.notifications) {
        realtimeSubscriptionsRef.current.notifications.unsubscribe();
        realtimeSubscriptionsRef.current.notifications = null;
      }
      if (realtimeSubscriptionsRef.current.attendance) {
        realtimeSubscriptionsRef.current.attendance.unsubscribe();
        realtimeSubscriptionsRef.current.attendance = null;
      }
      if (realtimeSubscriptionsRef.current.workMode) {
        realtimeSubscriptionsRef.current.workMode.unsubscribe();
        realtimeSubscriptionsRef.current.workMode = null;
      }
      // Stop location monitoring
      stopLocationMonitoring();
      console.log('[AUTH_CONTEXT] ✓ Realtime subscriptions cleaned up');
      
      // 2. Clear user state to prevent UI from rendering with stale data
      lastGoodProfileRef.current = null;
      setUser(null);
      setIsLoading(true);
      
      // 3. Sign out from Supabase (clears Supabase session)
      await supabase.auth.signOut();
      console.log('[AUTH_CONTEXT] ✓ Supabase signOut complete');
      
      // 4. Clear AsyncStorage session keys (defensive cleanup)
      try {
        const { clearSupabaseSession } = await import('../../utils/sessionHelper');
        await clearSupabaseSession();
        console.log('[AUTH_CONTEXT] ✓ AsyncStorage cleared');
      } catch (clearError) {
        console.warn('[AUTH_CONTEXT] Error clearing storage:', clearError);
      }

      // CACHE-3: Clear tenant-scoped cache keys so next user never sees prior tenant's data.
      try {
        await AsyncStorage.multiRemove([
          'work_mode_requests',
          'work_mode_history',
          'leave_settings',
          'employee_leaves',
          'company_employees',
        ]);
        console.log('[AUTH_CONTEXT] ✓ Tenant cache keys cleared');
      } catch (cacheError) {
        console.warn('[AUTH_CONTEXT] Error clearing tenant cache:', cacheError);
      }

      // 5. Reset loading state
      setIsLoading(false);
      console.log('[AUTH_CONTEXT] ✓ Logout complete');
      
    } catch (error) {
      console.error('[AUTH_CONTEXT] Logout error:', error);
      // Even if signOut fails, clear local state and subscriptions
      if (realtimeSubscriptionsRef.current.notifications) {
        realtimeSubscriptionsRef.current.notifications.unsubscribe();
        realtimeSubscriptionsRef.current.notifications = null;
      }
      if (realtimeSubscriptionsRef.current.attendance) {
        realtimeSubscriptionsRef.current.attendance.unsubscribe();
        realtimeSubscriptionsRef.current.attendance = null;
      }
      if (realtimeSubscriptionsRef.current.workMode) {
        realtimeSubscriptionsRef.current.workMode.unsubscribe();
        realtimeSubscriptionsRef.current.workMode = null;
      }
      // Stop location monitoring
      stopLocationMonitoring();
      lastGoodProfileRef.current = null;
      setUser(null);
      setIsLoading(false);
      
      // Try to clear AsyncStorage manually
      try {
        const { clearSupabaseSession } = await import('../../utils/sessionHelper');
        await clearSupabaseSession();
      } catch (clearError) {
        console.error('[AUTH_CONTEXT] Failed to clear storage:', clearError);
      }
      try {
        await AsyncStorage.multiRemove([
          'work_mode_requests',
          'work_mode_history',
          'leave_settings',
          'employee_leaves',
          'company_employees',
        ]);
      } catch (_) { /* non-fatal */ }
    }
  };

  const value = {
    user,
    isLoading,
    handleLogin,
    handleLogout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
