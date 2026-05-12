/**
 * AuthProvider loads the signed-in user from public.users, keeps JWT user_metadata
 * aligned (company_id, role, department_id) via the API Gateway sync-metadata endpoint,
 * and exposes tenant fields on context `user` (companyId, departmentId, role). The
 * database row is authoritative for display; JWT is refreshed for Supabase RLS.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { getEmployeeByUsername } from '../../utils/employees';
import { subscribeToNotifications } from '../../features/notifications/services/realtimeNotifications';
import { subscribeToAttendance } from '../../features/attendance/services/realtimeAttendance';
import { subscribeToWorkModeChanges } from '../../features/employees/services/realtimeEmployees';
import { startLocationMonitoring, stopLocationMonitoring } from '../../features/geofencing/services/locationMonitoringService';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const loadUserDataRef = useRef(null); // Track active loadUserData call to prevent race conditions
  const realtimeSubscriptionsRef = useRef({
    notifications: null,
    attendance: null,
    workMode: null,
  });

  useEffect(() => {
    // Get initial session with error handling
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.error('Error getting session:', error);
          // If refresh token error, clear session
          if (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token')) {
            console.log('Invalid refresh token detected, clearing session...');
            supabase.auth.signOut().catch(console.error);
          }
          setIsLoading(false);
          return;
        }
        
        if (session) {
          loadUserData(session.user.id);
        } else {
          setIsLoading(false);
        }
      })
      .catch((error) => {
        console.error('Error in getSession:', error);
        setIsLoading(false);
      });

    // Listen to Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session ? 'has session' : 'no session');
      
      // Handle token refresh errors
      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
        if (session?.user) {
          await loadUserData(session.user.id);
        }
      } else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        if (session?.user) {
          await loadUserData(session.user.id);
        } else {
          setUser(null);
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        await loadUserData(session.user.id);
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

  const loadUserData = async (userId) => {
    // Cancel any previous loadUserData call to prevent race conditions
    if (loadUserDataRef.current) {
      console.log('[AUTH_CONTEXT] Cancelling previous loadUserData');
      loadUserDataRef.current.cancelled = true;
    }
    
    const currentCall = { cancelled: false };
    loadUserDataRef.current = currentCall;
    
    try {
      // First verify the session is still valid
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      // Check if this call was cancelled
      if (currentCall.cancelled) {
        console.log('[AUTH_CONTEXT] loadUserData cancelled');
        return;
      }
      if (sessionError) {
        console.error('Session error in loadUserData:', sessionError);
        // If refresh token error, sign out
        if (sessionError.message?.includes('Refresh Token') || sessionError.message?.includes('refresh_token')) {
          console.log('Invalid refresh token, signing out...');
          await supabase.auth.signOut();
          setUser(null);
          setIsLoading(false);
          return;
        }
      }
      
      if (!session) {
        console.log('No active session');
        if (!currentCall.cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }
      
      // CRITICAL: Verify session.user.id matches userId to prevent loading wrong user data
      if (session.user.id !== userId) {
        console.warn('[AUTH_CONTEXT] Session userId mismatch:', {
          expected: userId,
          actual: session.user.id,
        });
        // Don't load data - session changed (user switched)
        return;
      }

      // Use session.user directly instead of calling getUser() again
      // This prevents AuthSessionMissingError when session exists but getUser() fails
      const authUser = session.user;

      // Try to get user data from Supabase database
      // First try by uid (should match Supabase Auth user ID)
      let { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('uid', userId)
        .single();
      
      // If uid query fails, try by email as fallback
      if (userError || !userData) {
        console.log('Query by uid failed, trying by email...', userError?.message);
        if (authUser?.email) {
          const { data: userDataByEmail, error: emailError } = await supabase
            .from('users')
            .select('*')
            .eq('email', authUser.email)
            .single();
          
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
        // Check if cancelled
        if (currentCall.cancelled) return;
        
        // Fallback to basic user info from auth (no DB row — tenant unknown)
        if (authUser) {
          console.warn('[AUTH_CONTEXT] No users row for uid; JWT-only fallback (RLS may fail until profile exists)');
          setUser({
            uid: authUser.id,
            email: authUser.email,
            username: authUser.email?.split('@')[0],
            role: 'employee',
            companyId: null,
            departmentId: null,
          });
        }
        setIsLoading(false);
        return;
      }
      
      // Check if cancelled before setting user
      if (currentCall.cancelled) {
        return;
      }

      /**
       * Multi-tenant: keep Supabase JWT user_metadata aligned with public.users
       * (company_id, role, department_id) via trusted auth-service + refreshSession.
       */
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
              department_id: userData.department_id,
            },
          });
        }
      } catch (syncBlockError) {
        console.error('[AUTH_CONTEXT] Tenant metadata sync block error:', syncBlockError?.message || syncBlockError);
      }
      
      // Try to get employee data for additional info
      let employee = null;
      if (userData.username) {
        try {
          employee = await getEmployeeByUsername(
            userData.username,
            userData.company_id != null ? String(userData.company_id) : null
          );
        } catch (error) {
          console.log('Employee not found, using database data only');
        }
      }
      
      // Combine Supabase user with database data and employee data
      // Note: authUser is already available from line 91
      const combinedUser = {
        uid: userId,
        email: authUser?.email || userData.email,
        username: userData.username || authUser?.email?.split('@')[0],
        role: userData.role || 'employee',
        companyId: userData.company_id != null ? String(userData.company_id) : null,
        departmentId: userData.department_id != null ? String(userData.department_id) : null,
        name: userData.name || employee?.name || authUser?.user_metadata?.name,
        department: userData.department || employee?.department || '',
        position: userData.position || employee?.position || '',
        workMode: userData.work_mode || employee?.workMode || 'in_office',
        hireDate: userData.hire_date || employee?.hireDate,
        id: employee?.id || userId,
      };
      
      // Final check before setting user
      if (!currentCall.cancelled) {
        setUser(combinedUser);
        // Realtime subscriptions will be set up in useEffect when user changes
      }
    } catch (error) {
      // Check if cancelled
      if (currentCall.cancelled) {
        return;
      }
      console.error('Error loading user data:', error);
      
      // Check if it's a refresh token error
      if (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token') || error.message?.includes('Invalid Refresh Token')) {
        console.log('Refresh token error detected, signing out...');
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('Error signing out:', signOutError);
        }
        if (!currentCall.cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }
      
      // Fallback to basic user info from session
      if (!currentCall.cancelled) {
        try {
          // Try to get session first, then use session.user instead of getUser()
          const { data: { session: fallbackSession }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError || !fallbackSession || !fallbackSession.user) {
            console.error('Error getting session in catch:', sessionError);
            if (sessionError?.message?.includes('Refresh Token') || sessionError?.message?.includes('refresh_token')) {
              await supabase.auth.signOut();
            }
            setUser(null);
          } else if (fallbackSession.user) {
            setUser({
              uid: fallbackSession.user.id,
              email: fallbackSession.user.email,
              username: fallbackSession.user.email?.split('@')[0],
              role: 'employee',
              companyId: null,
              departmentId: null,
            });
          }
        } catch (getSessionError) {
          console.error('Error in getSession fallback:', getSessionError);
          setUser(null);
        }
      }
    } finally {
      // Only update loading state if this call is still active
      if (loadUserDataRef.current === currentCall) {
        loadUserDataRef.current = null;
      }
      if (!currentCall.cancelled) {
        setIsLoading(false);
      }
    }
  };

  const handleLogin = async (userData) => {
    // Login is handled by Supabase Auth, this is just for compatibility
    // The actual login happens in LoginScreen using Supabase
    setUser(userData);
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
      setUser(null);
      setIsLoading(false);
      
      // Try to clear AsyncStorage manually
      try {
        const { clearSupabaseSession } = await import('../../utils/sessionHelper');
        await clearSupabaseSession();
      } catch (clearError) {
        console.error('[AUTH_CONTEXT] Failed to clear storage:', clearError);
      }
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
