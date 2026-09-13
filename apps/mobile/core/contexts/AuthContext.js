/**
 * AuthProvider loads the signed-in user from public.users (canonical profile + tenant),
 * keeps JWT user_metadata aligned with that row via gateway sync, and exposes one `user`
 * object on context. In-memory profile is preserved on transient read failures so roles
 * are never silently downgraded.
 *
 * Rehydration is coalesced to avoid TOKEN_REFRESHED → sync → refreshSession → TOKEN_REFRESHED
 * loops that remount UI after gateway latency spikes.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase';
import { isPasswordRecoveryActive } from '../auth/passwordRecoveryFlag';
import { getTenantClaimsFromSession } from '../auth/tenantClaims';
import { normalizeEmailForAuth } from '../auth/normalizeLogin';
import { requireValidCompanyId } from '../tenant/tenantScope';
import { tenantDiagLog } from '../debug/tenantRuntimeDiag';
import { subscribeToNotifications } from '../../features/notifications/services/realtimeNotifications';
import { subscribeToAttendance } from '../../features/attendance/services/realtimeAttendance';
import { subscribeToWorkModeChanges } from '../../features/employees/services/realtimeEmployees';
import {
  startLocationMonitoring,
  stopLocationMonitoring,
  updateLocationMonitoringUser,
} from '../../features/geofencing/services/locationMonitoringService';

const AuthContext = createContext();

/** Min gap between AppState-driven profile reloads (ms). */
const FOREGROUND_RELOAD_MIN_MS = 30_000;
/** Min gap between TOKEN_REFRESHED-driven profile reloads for the same uid (ms). */
const TOKEN_REFRESH_LOAD_THROTTLE_MS = 15_000;
/** Clear sync→TOKEN_REFRESHED skip flag if the event never arrives. */
const SKIP_TOKEN_REFRESH_LOAD_TTL_MS = 5_000;

async function fetchManagerPermissions(uid, role) {
  if (!uid || role !== 'manager') return [];
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('permission_key, granted')
    .eq('manager_uid', uid);
  if (error) {
    console.warn('[AUTH_CONTEXT] manager permissions load failed:', error.message);
    return [];
  }
  return (data || []).filter((row) => row.granted === true).map((row) => row.permission_key);
}

/**
 * Deep-equality for auth profile fields that affect UI / authorization.
 * Ignores object identity so identical rehydrations do not call setState.
 */
function areAuthProfilesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const permsA = Array.isArray(a.permissions) ? [...a.permissions].map(String).sort().join('\0') : '';
  const permsB = Array.isArray(b.permissions) ? [...b.permissions].map(String).sort().join('\0') : '';
  return (
    String(a.uid ?? '') === String(b.uid ?? '') &&
    String(a.id ?? '') === String(b.id ?? '') &&
    String(a.email ?? '') === String(b.email ?? '') &&
    String(a.username ?? '') === String(b.username ?? '') &&
    String(a.role ?? '') === String(b.role ?? '') &&
    String(a.companyId ?? '') === String(b.companyId ?? '') &&
    String(a.departmentId ?? '') === String(b.departmentId ?? '') &&
    String(a.name ?? '') === String(b.name ?? '') &&
    String(a.department ?? '') === String(b.department ?? '') &&
    String(a.position ?? '') === String(b.position ?? '') &&
    String(a.workMode ?? a.work_mode ?? '') === String(b.workMode ?? b.work_mode ?? '') &&
    String(a.hireDate ?? '') === String(b.hireDate ?? '') &&
    permsA === permsB
  );
}

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

  /** Always-current user for realtime callbacks / location without re-subscribing. */
  const userRef = useRef(null);
  /** Skip the next TOKEN_REFRESHED → loadUserData (set around gateway sync refreshSession). */
  const skipNextTokenRefreshLoadRef = useRef(false);
  const skipTokenRefreshLoadTimerRef = useRef(null);
  /** Coalesce concurrent loadUserData for the same uid. */
  const loadInFlightRef = useRef(null); // { userId: string, promise: Promise }
  /** Last successful / attempted profile load timestamps by reason. */
  const lastLoadCompletedAtRef = useRef(0);
  const lastForegroundReloadAtRef = useRef(0);
  const lastTokenRefreshLoadAtRef = useRef(0);
  /** Stable handle so the auth subscription effect can call the latest loader. */
  const loadUserDataRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
    if (user?.uid) {
      updateLocationMonitoringUser(user);
    }
  }, [user]);

  const applyUserProfile = useCallback((next) => {
    setUser((prev) => {
      if (next == null) {
        lastGoodProfileRef.current = null;
        return null;
      }
      if (areAuthProfilesEqual(prev, next)) {
        return prev;
      }
      lastGoodProfileRef.current = next;
      return next;
    });
  }, []);

  const armSkipNextTokenRefreshLoad = useCallback(() => {
    skipNextTokenRefreshLoadRef.current = true;
    if (skipTokenRefreshLoadTimerRef.current) {
      clearTimeout(skipTokenRefreshLoadTimerRef.current);
    }
    skipTokenRefreshLoadTimerRef.current = setTimeout(() => {
      skipNextTokenRefreshLoadRef.current = false;
      skipTokenRefreshLoadTimerRef.current = null;
    }, SKIP_TOKEN_REFRESH_LOAD_TTL_MS);
  }, []);

  const consumeSkipNextTokenRefreshLoad = useCallback(() => {
    if (!skipNextTokenRefreshLoadRef.current) return false;
    skipNextTokenRefreshLoadRef.current = false;
    if (skipTokenRefreshLoadTimerRef.current) {
      clearTimeout(skipTokenRefreshLoadTimerRef.current);
      skipTokenRefreshLoadTimerRef.current = null;
    }
    return true;
  }, []);

  const loadUserData = useCallback(async (userId, options = {}) => {
    const reason = options.reason || 'default';

    if (!userId) return;

    // Coalesce concurrent loads for the same authenticated user.
    if (loadInFlightRef.current?.userId === String(userId)) {
      console.log('[AUTH_CONTEXT] loadUserData coalesced (in-flight)', { userId, reason });
      return loadInFlightRef.current.promise;
    }

    const run = (async () => {
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
              applyUserProfile(null);
              setIsLoading(false);
            }
            return;
          }
        }

        if (!session) {
          console.log('No active session');
          if (!isStale()) {
            lastGoodProfileRef.current = null;
            applyUserProfile(null);
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
          reason,
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
              applyUserProfile(fallback);
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
                applyUserProfile({ ...keep, email: authUser.email ?? keep.email });
              } else {
                applyUserProfile(null);
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
          const { shouldSyncTenantMetadata, getTenantClaimsFromSession: getClaims, tenantClaimsMatchUserRow } =
            await import('../auth/tenantClaims');
          const { syncTenantMetadataViaGateway } = await import('../auth/syncTenantMetadata');

          let sessionForClaims = session;
          if (shouldSyncTenantMetadata(session, userData)) {
            console.log('[AUTH_CONTEXT] JWT tenant metadata missing or stale vs users row; syncing via gateway...');
            // refreshSession inside sync emits TOKEN_REFRESHED — do not re-enter loadUserData.
            armSkipNextTokenRefreshLoad();
            const syncResult = await syncTenantMetadataViaGateway();
            if (!syncResult.success) {
              console.error('[AUTH_CONTEXT] Tenant metadata sync failed:', syncResult.error);
              // No TOKEN_REFRESHED expected on failure — allow future refresh loads.
              consumeSkipNextTokenRefreshLoad();
            }
            const { data: { session: refreshed }, error: refreshReadError } = await supabase.auth.getSession();
            if (refreshReadError) {
              console.warn('[AUTH_CONTEXT] getSession after sync:', refreshReadError.message);
            }
            if (refreshed) {
              sessionForClaims = refreshed;
            }
          }

          const claims = getClaims(sessionForClaims);
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
          consumeSkipNextTokenRefreshLoad();
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
            applyUserProfile({ ...keep, email: authUser?.email ?? keep.email });
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
          permissions: await (async () => {
            try {
              const { refreshPermissionsFromServer } = await import('../api/workflowApi');
              const refreshed = await refreshPermissionsFromServer({
                uid: userId,
                role: dbRole,
                permissions: await fetchManagerPermissions(userId, dbRole),
              });
              if (refreshed.success) return refreshed.permissions;
            } catch (_) {}
            return fetchManagerPermissions(userId, dbRole);
          })(),
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
          applyUserProfile(combinedUser);
          lastLoadCompletedAtRef.current = Date.now();
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
            applyUserProfile(null);
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
              applyUserProfile(null);
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
              applyUserProfile(fb);
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
                applyUserProfile({ ...keep, email: fallbackSession.user.email ?? keep.email });
              } else {
                applyUserProfile(null);
              }
            }
          }
        } catch (getSessionError) {
          console.error('Error in getSession fallback:', getSessionError);
          if (!isStale()) {
            lastGoodProfileRef.current = null;
            applyUserProfile(null);
          }
        }
      } finally {
        if (!isStale()) {
          setIsLoading(false);
        }
      }
    })();

    loadInFlightRef.current = { userId: String(userId), promise: run };
    try {
      await run;
    } finally {
      if (loadInFlightRef.current?.promise === run) {
        loadInFlightRef.current = null;
      }
    }
  }, [applyUserProfile, armSkipNextTokenRefreshLoad, consumeSkipNextTokenRefreshLoad]);

  loadUserDataRef.current = loadUserData;

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

    const scheduleLoadUserData = (userId, reason) => {
      setTimeout(() => {
        void loadUserDataRef.current?.(userId, { reason });
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session ? 'has session' : 'no session');

      if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id, 'INITIAL_SESSION');
        } else {
          applyUserProfile(null);
          setIsLoading(false);
        }
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
        if (consumeSkipNextTokenRefreshLoad()) {
          console.log('[AUTH_CONTEXT] Skipping loadUserData after sync-driven refreshSession');
          return;
        }
        if (session?.user) {
          const now = Date.now();
          if (now - lastTokenRefreshLoadAtRef.current < TOKEN_REFRESH_LOAD_THROTTLE_MS) {
            console.log('[AUTH_CONTEXT] Throttling TOKEN_REFRESHED loadUserData');
            return;
          }
          if (now - lastLoadCompletedAtRef.current < TOKEN_REFRESH_LOAD_THROTTLE_MS) {
            console.log('[AUTH_CONTEXT] Skipping TOKEN_REFRESHED load — profile recently loaded');
            return;
          }
          lastTokenRefreshLoadAtRef.current = now;
          scheduleLoadUserData(session.user.id, 'TOKEN_REFRESHED');
        }
      } else if (event === 'SIGNED_OUT') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id, 'SIGNED_OUT');
        } else {
          applyUserProfile(null);
          setIsLoading(false);
        }
      } else if (event === 'USER_UPDATED') {
        if (session?.user) {
          scheduleLoadUserData(session.user.id, 'USER_UPDATED');
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        // exchangeCodeForSession (the manual RN path AppNavigator uses for the
        // password-reset deep link) always fires SIGNED_IN — it never emits
        // PASSWORD_RECOVERY the way the browser SDK does. Adopting that
        // session here would route the user into the main app instead of the
        // reset-password screen, using a session they never meant to log in
        // with. Skip it; ResetPasswordScreen reads the session itself.
        if (isPasswordRecoveryActive()) {
          console.log('[AUTH_CONTEXT] Ignoring SIGNED_IN during password recovery');
          return;
        }
        scheduleLoadUserData(session.user.id, 'SIGNED_IN');
      } else if (!session) {
        applyUserProfile(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (skipTokenRefreshLoadTimerRef.current) {
        clearTimeout(skipTokenRefreshLoadTimerRef.current);
      }
    };
  }, [applyUserProfile, consumeSkipNextTokenRefreshLoad]);

  // Realtime + location: recreate only when authenticated uid changes (not every profile refresh).
  const authUid = user?.uid ?? null;
  useEffect(() => {
    if (!authUid) {
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
      stopLocationMonitoring();
      return;
    }

    const profile = userRef.current;
    if (!profile?.uid) return;

    console.log('[AUTH_CONTEXT] Setting up realtime subscriptions for user:', profile.username);

    try {
      if (!realtimeSubscriptionsRef.current.notifications) {
        const notificationsSub = subscribeToNotifications(
          authUid,
          profile.username,
          (data) => {
            console.log('[AUTH_CONTEXT] Notification received via realtime:', data.notification.id);
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

    try {
      if (!realtimeSubscriptionsRef.current.attendance) {
        const attendanceSub = subscribeToAttendance(
          profile,
          (data) => {
            console.log('[AUTH_CONTEXT] Attendance change via realtime:', data.type, data.record.id);
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

    try {
      if (!realtimeSubscriptionsRef.current.workMode) {
        const workModeSub = subscribeToWorkModeChanges(
          profile,
          (data) => {
            console.log('[AUTH_CONTEXT] Work mode change via realtime:', data.username, data.oldWorkMode, '->', data.newWorkMode);
            const current = userRef.current;
            if (current && (data.uid === current.uid || data.username === current.username)) {
              applyUserProfile({
                ...current,
                workMode: data.newWorkMode,
                work_mode: data.newWorkMode,
              });
            }
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

    (async () => {
      try {
        const latest = userRef.current;
        if (!latest?.uid) return;
        console.log('[AUTH_CONTEXT] Starting location monitoring for user:', latest.username);
        await startLocationMonitoring(latest);
      } catch (error) {
        console.error('[AUTH_CONTEXT] Error starting location monitoring:', error);
      }
    })();

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
      stopLocationMonitoring();
    };
  }, [authUid, applyUserProfile]);

  // ATT-3: Drain offline attendance queue when app comes back to foreground.
  useEffect(() => {
    if (!user?.companyId) return;
    const companyId = user.companyId;
    const handleAppStateChange = (nextState) => {
      if (nextState === 'active') {
        import('../../utils/storage').then(({ syncOfflineAttendanceQueue }) => {
          syncOfflineAttendanceQueue(companyId).catch((err) => {
            console.warn('[AUTH_CONTEXT] syncOfflineAttendanceQueue error:', err?.message || err);
          });
        });
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [user?.companyId]);

  // Reload profile on foreground — debounced to avoid blink on rapid background/foreground.
  useEffect(() => {
    if (!authUid) return;
    const handleAppStateChange = (nextState) => {
      if (nextState !== 'active') return;
      const now = Date.now();
      if (now - lastForegroundReloadAtRef.current < FOREGROUND_RELOAD_MIN_MS) {
        console.log('[AUTH_CONTEXT] Skipping foreground loadUserData (debounced)');
        return;
      }
      if (loadInFlightRef.current?.userId === String(authUid)) {
        console.log('[AUTH_CONTEXT] Skipping foreground loadUserData (already in-flight)');
        return;
      }
      lastForegroundReloadAtRef.current = now;
      void loadUserDataRef.current?.(authUid, { reason: 'AppState.active' });
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [authUid]);

  const handleLogin = useCallback(async (userData) => {
    if (userData?.uid) {
      lastGoodProfileRef.current = { ...userData };
    }
    tenantDiagLog('AuthContext.handleLogin', {
      uid: userData?.uid,
      role: userData?.role,
      companyId: userData?.companyId ?? userData?.company_id,
      username: userData?.username,
    });
    applyUserProfile(userData);
    if (userData?.uid) {
      await loadUserData(userData.uid, { reason: 'handleLogin' });
    }
  }, [applyUserProfile, loadUserData]);

  const handleLogout = useCallback(async () => {
    try {
      console.log('[AUTH_CONTEXT] Logout started');

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
      stopLocationMonitoring();
      console.log('[AUTH_CONTEXT] ✓ Realtime subscriptions cleaned up');

      lastGoodProfileRef.current = null;
      lastLoadCompletedAtRef.current = 0;
      lastForegroundReloadAtRef.current = 0;
      lastTokenRefreshLoadAtRef.current = 0;
      applyUserProfile(null);
      // Keep NavigationContainer mounted; AppNavigator shows a lightweight overlay.
      setIsLoading(true);

      await supabase.auth.signOut();
      console.log('[AUTH_CONTEXT] ✓ Supabase signOut complete');

      try {
        const { clearSupabaseSession } = await import('../../utils/sessionHelper');
        await clearSupabaseSession();
        console.log('[AUTH_CONTEXT] ✓ AsyncStorage cleared');
      } catch (clearError) {
        console.warn('[AUTH_CONTEXT] Error clearing storage:', clearError);
      }

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

      setIsLoading(false);
      console.log('[AUTH_CONTEXT] ✓ Logout complete');
    } catch (error) {
      console.error('[AUTH_CONTEXT] Logout error:', error);
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
      stopLocationMonitoring();
      lastGoodProfileRef.current = null;
      applyUserProfile(null);
      setIsLoading(false);

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
  }, [applyUserProfile]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      handleLogin,
      handleLogout,
    }),
    [user, isLoading, handleLogin, handleLogout]
  );

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
