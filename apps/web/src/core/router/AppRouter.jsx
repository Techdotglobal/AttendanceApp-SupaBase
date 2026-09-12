import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { createLenis, destroyLenis, resetScrollPosition } from '../../shared/lib/smoothScroll';
import { LucideProvider } from 'lucide-react';
import { useAuthStore } from '../../features/auth/store/authStore';
import { canAccessFeature, isSuperAdmin } from '../../features/admin/permissions';
import { AccessDenied } from '../../shared/components/PermissionGate';
import { AppLoader } from '../../shared/components/ui';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { ForgotPasswordPage } from '../../features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../../features/auth/pages/ResetPasswordPage';
import { CompanyOnboardingPage } from '../../features/auth/pages/CompanyOnboardingPage';
import { LandingPage } from '../../features/landing/pages/LandingPage';
import { AppShell } from '../../shared/components/AppShell';
import { DashboardPage } from '../../features/admin/pages/DashboardPage';
import { UsersPage } from '../../features/admin/pages/UsersPage';
import { DepartmentsPage } from '../../features/admin/pages/DepartmentsPage';
import { SitesPage } from '../../features/admin/pages/SitesPage';
import { AttendancePage } from '../../features/admin/pages/AttendancePage';
import { LeavesPage } from '../../features/admin/pages/LeavesPage';
import { TicketsPage } from '../../features/admin/pages/TicketsPage';
import { CalendarPage } from '../../features/admin/pages/CalendarPage';
import { AnalyticsPage } from '../../features/admin/pages/AnalyticsPage';
import { ReportsPage } from '../../features/admin/pages/ReportsPage';
import { SettingsPage } from '../../features/admin/pages/SettingsPage';
import { ManagerPermissionsPage } from '../../features/admin/pages/ManagerPermissionsPage';
import { ApprovalWorkflowsPage } from '../../features/admin/pages/ApprovalWorkflowsPage';
import { WorkModeRequestsPage } from '../../features/admin/pages/WorkModeRequestsPage';
import { NotificationsPage } from '../../features/admin/pages/NotificationsPage';
import { PayrollDashboardPage } from '../../features/admin/pages/PayrollDashboardPage';
import { PayrollPeriodPage } from '../../features/admin/pages/PayrollPeriodPage';
import { PayrollEmployeesPage } from '../../features/admin/pages/PayrollEmployeesPage';
import { PayrollReportsPage } from '../../features/admin/pages/PayrollReportsPage';

function Protected({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <AppLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Unauthorized() {
  return <AccessDenied />;
}

/**
 * House glyph weight for the portal. Lucide's 2px default reads heavy next to the
 * system font at 14-16px; SF Symbols sit nearer 1.75 at those sizes, and a single
 * absolute 1.75px stroke at 18px is what makes an icon set look drawn as one family.
 * The landing page is outside this and keeps its own voice.
 */
function PortalIcons({ children }) {
  return (
    <LucideProvider size={18} strokeWidth={1.75} absoluteStrokeWidth>
      {children}
    </LucideProvider>
  );
}

function PermissionRoute({ feature, superAdminOnly = false, children }) {
  const { user } = useAuthStore();
  if (superAdminOnly && !isSuperAdmin(user)) return <AccessDenied />;
  if (!canAccessFeature(user, feature)) return <AccessDenied />;
  return children;
}

const WINDOW_SCROLL_ROUTES = new Set([
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/onboard',
  '/unauthorized',
]);

function WindowSmoothScroll() {
  const { pathname } = useLocation();
  const usesWindowScroll = WINDOW_SCROLL_ROUTES.has(pathname);

  useEffect(() => {
    if (!usesWindowScroll) return undefined;
    createLenis();
    return () => destroyLenis();
  }, [usesWindowScroll]);

  useEffect(() => {
    if (!usesWindowScroll) return;
    resetScrollPosition();
  }, [pathname, usesWindowScroll]);

  return null;
}

export function AppRouter() {
  const { bootstrap } = useAuthStore();
  useEffect(() => { bootstrap(); }, [bootstrap]);

  return (
    <>
      <WindowSmoothScroll />
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/onboard" element={<CompanyOnboardingPage />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      {/* Pathless layout: keeps /users, /attendance, etc. while freeing / for marketing */}
      <Route element={<Protected><PortalIcons><AppShell /></PortalIcons></Protected>}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<PermissionRoute feature="users"><UsersPage /></PermissionRoute>} />
        <Route path="departments" element={<PermissionRoute feature="departments"><DepartmentsPage /></PermissionRoute>} />
        <Route path="analytics" element={<PermissionRoute feature="analytics"><AnalyticsPage /></PermissionRoute>} />
        <Route path="reports" element={<PermissionRoute feature="reports"><ReportsPage /></PermissionRoute>} />
        <Route path="settings" element={<PermissionRoute feature="settings"><SettingsPage /></PermissionRoute>} />
        <Route path="manager-permissions" element={<PermissionRoute feature="permissions" superAdminOnly><ManagerPermissionsPage /></PermissionRoute>} />
        <Route path="sites" element={<PermissionRoute feature="sites"><SitesPage /></PermissionRoute>} />
        <Route path="attendance" element={<PermissionRoute feature="attendance"><AttendancePage /></PermissionRoute>} />
        <Route path="leaves" element={<PermissionRoute feature="leaves"><LeavesPage /></PermissionRoute>} />
        <Route path="work-mode-requests" element={<PermissionRoute feature="workModeRequests"><WorkModeRequestsPage /></PermissionRoute>} />
        <Route path="approval-workflows" element={<PermissionRoute feature="approvalWorkflows" superAdminOnly><ApprovalWorkflowsPage /></PermissionRoute>} />
        <Route path="tickets" element={<PermissionRoute feature="tickets"><TicketsPage /></PermissionRoute>} />
        <Route path="calendar" element={<PermissionRoute feature="calendar"><CalendarPage /></PermissionRoute>} />
        <Route path="notifications" element={<PermissionRoute feature="notifications"><NotificationsPage /></PermissionRoute>} />
        <Route path="payroll" element={<PermissionRoute feature="payroll" superAdminOnly><PayrollDashboardPage /></PermissionRoute>} />
        <Route path="payroll/employees" element={<PermissionRoute feature="payroll" superAdminOnly><PayrollEmployeesPage /></PermissionRoute>} />
        <Route path="payroll/reports" element={<PermissionRoute feature="payroll" superAdminOnly><PayrollReportsPage /></PermissionRoute>} />
        <Route path="payroll/periods/:id" element={<PermissionRoute feature="payroll" superAdminOnly><PayrollPeriodPage /></PermissionRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
