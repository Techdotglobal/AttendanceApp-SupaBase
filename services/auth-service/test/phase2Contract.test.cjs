const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function authorizationFake({ target, requesterAssignments = [], targetAssignments = [], grants = [] } = {}) {
  const rowsFor = (table, filters) => {
    if (table === 'users') return target ? [target] : [];
    if (table === 'user_department_assignments') {
      const uid = filters.user_uid;
      return (uid === target?.uid ? targetAssignments : requesterAssignments).map((department_id, index) => ({ department_id, is_primary: index === 0 }));
    }
    if (table === 'permission_grants') return grants;
    return [];
  };
  return {
    from(table) {
      const filters = {};
      const builder = {
        select: () => builder,
        eq: (key, value) => { filters[key] = value; return builder; },
        order: () => builder,
        maybeSingle: async () => ({ data: rowsFor(table, filters)[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: rowsFor(table, filters), error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

test('approval HTTP routes retain the existing endpoint surface and guards', () => {
  const workflowRoutes = read('services/auth-service/routes/workflowRoutes.js');
  const adminRoutes = read('services/auth-service/routes/admin.js');
  for (const route of [
    "router.get('/approval-workflows'",
    "router.put('/approval-workflows/:requestType'",
    "router.get('/approval-workflows/:requestType/audit'",
    "router.get('/work-mode-requests'",
    "router.patch('/work-mode-requests/:id'",
  ]) assert.match(workflowRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const route of ["router.get('/leaves'", "router.post('/leaves'", "router.patch('/leaves/:id'"]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workflowRoutes, /requireSuperAdmin\(requester, res\)/);
  assert.match(workflowRoutes, /canUserActOnStep/);
  assert.match(adminRoutes, /processApprovalStep/);
});

test('leave reconciliation is restricted to final approval and preserves retryability', () => {
  const adminRoutes = read('services/auth-service/routes/admin.js');
  assert.match(adminRoutes, /select\('id, employee_uid, status, leave_type, start_date, end_date, days, is_half_day, current_step'\)/);
  assert.match(adminRoutes, /result\.final && finalStatus === 'approved'/);
  assert.match(adminRoutes, /reconcileApprovedLeaveAbsenceOutcomes/);
  assert.match(adminRoutes, /reconciliation_pending/);
  assert.match(adminRoutes, /result\.final \? result\.status : 'pending'/);
});

test('approval workflow listing uses the shared gateway client and bounded eligibility reads', () => {
  const page = read('apps/web/src/features/admin/pages/ApprovalWorkflowsPage.jsx');
  const service = read('apps/web/src/features/admin/services/adminService.js');
  const client = read('apps/web/src/core/api/client.js');
  const gateway = read('services/api-gateway/routes/admin.js');
  const workflowRoutes = read('services/auth-service/routes/workflowRoutes.js');
  assert.match(page, /adminService\.getApprovalWorkflows\(\)/);
  assert.match(service, /api\.get\(apiUrl\('\/api\/admin\/approval-workflows'\)\)/);
  assert.match(client, /timeout: 10000/);
  assert.match(gateway, /router\.get\('\/approval-workflows'/);
  assert.match(workflowRoutes, /request-scoped cache/);
  assert.match(workflowRoutes, /const withSteps = \[\]/);
});

test('migration protects approval actions with approver_uid and denies client writes', () => {
  const migration = read('supabase/migrations/20261005100000_flexible_approval_authority.sql');
  assert.match(migration, /approver_uid = auth\.uid\(\)::text/);
  const actionPolicy = migration
    .split('CREATE POLICY approval_actions_own_request_read')[1]
    .split('DROP POLICY IF EXISTS approval_audit_own_request_read')[0];
  assert.doesNotMatch(actionPolicy, /actor_uid = auth\.uid/);
  assert.match(actionPolicy, /approver_uid = auth\.uid/);
  assert.match(migration, /REVOKE ALL ON public\.approval_request_actions FROM anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON public\.approval_audit_logs FROM anon, authenticated/);
});

test('mobile administrative approval mutations use the gateway', () => {
  const leave = read('apps/mobile/utils/leaveManagement.js');
  const workflowApi = read('apps/mobile/core/api/workflowApi.js');
  const employees = read('apps/mobile/utils/employees.js');
  assert.match(leave, /processLeaveRequestApi/);
  assert.match(workflowApi, /\/api\/admin\/leaves\/\$\{id\}/);
  assert.match(employees, /processWorkModeRequestApi/);
  assert.doesNotMatch(leave, /\.from\(['"]leave_requests['"]\)\s*\.update\(/);
});

test('web workflow editor exposes no-eligible-approver warnings', () => {
  const page = read('apps/web/src/features/admin/pages/ApprovalWorkflowsPage.jsx');
  const routes = read('services/auth-service/routes/workflowRoutes.js');
  assert.match(page, /eligible_approver_count/);
  assert.match(page, /no eligible approver/i);
  assert.match(routes, /addWorkflowEligibility/);
  assert.match(routes, /eligibility_warning/);
});

test('approval engine keeps snapshots, next-step authority, and concurrency guards', () => {
  const engine = read('services/auth-service/lib/approvalEngine.js');
  for (const field of ['workflow_version', 'authority_type', 'organization_role_id', 'required_permission_key', 'required_scope_type', 'approval_department_id']) {
    assert.match(engine, new RegExp(field));
  }
  assert.match(engine, /\.eq\('action', 'pending'\)/);
  assert.match(engine, /no_eligible_approver/);
  assert.match(engine, /nextPending\.required_permission_key/);
  assert.match(engine, /nextPending\.required_scope_type/);
});

test('Phase 2 migration preserves legacy workflows and enforces tenant references', () => {
  const migration = read('supabase/migrations/20261005100000_flexible_approval_authority.sql');
  const preflight = read('supabase/phase2_approval_authority_preflight.sql');

  assert.match(migration, /approval_workflows_company_type_companywide_key/);
  assert.match(migration, /WHERE department_id IS NULL/);
  assert.match(migration, /approval_workflows_company_type_department_key/);
  assert.match(migration, /WHERE department_id IS NOT NULL/);
  assert.doesNotMatch(migration, /SET authority_type = 'PERMISSION'/);
  assert.match(migration, /enforce_approval_action_company/);
  assert.match(migration, /enforce_leave_approval_department_company/);
  assert.match(migration, /enforce_work_mode_approval_department_company/);
  assert.match(migration, /approval action organization role must stay within the action company/);
  assert.match(migration, /approval action approver must stay within the action company/);

  assert.match(preflight, /approval_request_actions/);
  assert.match(preflight, /approval_workflow_steps/);
  assert.match(preflight, /permission_grants/);
  assert.match(preflight, /wr\.company_id IS DISTINCT FROM a\.company_id/);
});

test('approval audit RLS keeps remote-work self-request visibility restricted', () => {
  const migration = read('supabase/migrations/20261005100000_flexible_approval_authority.sql');
  const auditPolicy = migration.split('CREATE POLICY approval_audit_own_request_read')[1];
  assert.match(auditPolicy, /request_type = 'remote_work'/);
  assert.match(auditPolicy, /wr\.employee_uid = auth\.uid\(\)::text/);
  assert.match(auditPolicy, /wr\.company_id = approval_audit_logs\.company_id/);
});

test('Phase 5 admin surfaces keep organizational access separate and tenant guarded', () => {
  const adminRoutes = read('services/auth-service/routes/admin.js');
  const gatewayRoutes = read('services/api-gateway/routes/admin.js');
  const usersPage = read('apps/web/src/features/admin/pages/UsersPage.jsx');
  const permissionsPage = read('apps/web/src/features/admin/pages/ManagerPermissionsPage.jsx');
  const rulesPage = read('apps/web/src/features/admin/pages/AttendanceRulesPage.jsx');
  assert.match(adminRoutes, /router\.patch\('\/organization-roles\/:id'/);
  assert.match(adminRoutes, /router\.delete\('\/organization-roles\/:id'/);
  assert.match(adminRoutes, /organization_roles.*company_id/s);
  assert.match(adminRoutes, /assign_user_permissions/);
  assert.match(gatewayRoutes, /organization-roles\/:id/);
  assert.match(usersPage, /organization_role_id/);
  assert.match(usersPage, /updateUserDepartments/);
  assert.match(permissionsPage, /Organizational roles/);
  assert.match(permissionsPage, /grant-department/);
  assert.match(rulesPage, /updateAttendanceRule/);
  assert.match(rulesPage, /updateAttendanceHoliday/);
});

test('Phase 5 blocker fixes keep delegated authorization scoped and protected', () => {
  const permissions = read('services/auth-service/lib/permissions.js');
  const admin = read('services/auth-service/routes/admin.js');
  assert.match(permissions, /requesterDepartmentIds/);
  assert.match(permissions, /target\.is_active === false/);
  assert.match(permissions, /target\.role === 'super_admin'/);
  assert.match(permissions, /ASSIGNED_DEPARTMENTS/);
  assert.match(admin, /replace_user_department_assignments/);
  assert.match(admin, /Inactive users cannot receive permissions/);
  assert.match(admin, /Cannot modify super admin permissions/);
  assert.doesNotMatch(admin, /organization_role_id:.*updates/);
});

test('delegated grants enforce semantic ceilings and target protections at runtime', async () => {
  const { canDelegatePermission } = require('../lib/permissions');
  const requester = { uid: 'admin-1', role: 'manager', company_id: 'company-1', department_id: 'dept-1' };
  const base = {
    target: { uid: 'employee-1', role: 'employee', company_id: 'company-1', department_id: 'dept-1', is_active: true },
    requesterAssignments: ['dept-1'],
    targetAssignments: ['dept-1'],
    grants: [
      { permission_key: 'assign_user_permissions', granted: true, scope_type: 'DEPARTMENT', department_id: 'dept-1' },
      { permission_key: 'approve_leave', granted: true, scope_type: 'DEPARTMENT', department_id: 'dept-1' },
    ],
  };
  assert.equal(await canDelegatePermission(authorizationFake(base), requester, 'employee-1', 'approve_leave', 'DEPARTMENT', 'dept-1'), true);
  assert.equal(await canDelegatePermission(authorizationFake(base), requester, 'employee-1', 'approve_leave', 'ASSIGNED_DEPARTMENTS'), false);
  assert.equal(await canDelegatePermission(authorizationFake(base), requester, 'admin-1', 'approve_leave', 'DEPARTMENT', 'dept-1'), false);
  assert.equal(await canDelegatePermission(authorizationFake({ ...base, target: { ...base.target, company_id: 'company-2' } }), requester, 'employee-1', 'approve_leave', 'DEPARTMENT', 'dept-1'), false);
  assert.equal(await canDelegatePermission(authorizationFake({ ...base, target: { ...base.target, is_active: false } }), requester, 'employee-1', 'approve_leave', 'DEPARTMENT', 'dept-1'), false);
  assert.equal(await canDelegatePermission(authorizationFake({ ...base, target: { ...base.target, role: 'super_admin' } }), requester, 'employee-1', 'approve_leave', 'DEPARTMENT', 'dept-1'), false);
  const assigned = { ...base, requesterAssignments: ['dept-1', 'dept-2'], targetAssignments: ['dept-2'], grants: [
    { permission_key: 'assign_user_permissions', granted: true, scope_type: 'ASSIGNED_DEPARTMENTS', department_id: null },
    { permission_key: 'approve_leave', granted: true, scope_type: 'ASSIGNED_DEPARTMENTS', department_id: null },
  ] };
  assert.equal(await canDelegatePermission(authorizationFake(assigned), requester, 'employee-1', 'approve_leave', 'ASSIGNED_DEPARTMENTS'), true);
});

test('Phase 5 administrative replacements are transactional and cache invalidation is targeted', () => {
  const migration = read('supabase/migrations/20261007150000_phase5_admin_transactions.sql');
  const workflows = read('services/auth-service/routes/workflowRoutes.js');
  const cache = read('services/api-gateway/lib/authenticate.js');
  const gateway = read('services/api-gateway/routes/admin.js');
  assert.match(migration, /replace_user_department_assignments/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /create_approval_workflow_with_steps/);
  assert.match(migration, /replace_approval_workflow_steps/);
  assert.match(workflows, /supabase\.rpc\('replace_approval_workflow_steps'/);
  assert.doesNotMatch(workflows, /approval_workflow_steps'\)\.delete/);
  assert.match(cache, /invalidateIdentityCache/);
  assert.match(gateway, /invalidateAfterAdminMutation/);
});

test('Phase 5 UI exposes holiday type and finalized absence fields', () => {
  const rules = read('apps/web/src/features/admin/pages/AttendanceRulesPage.jsx');
  const attendance = read('apps/web/src/features/admin/pages/AttendancePage.jsx');
  assert.match(rules, /holiday\.holiday_type/);
  assert.match(rules, /value="religious"/);
  assert.match(rules, /Save holiday/);
  assert.match(attendance, /requested_days/);
  assert.match(attendance, /policy_snapshot/);
  assert.match(attendance, /canReconcile/);
});

test('Attendance Rules exposes the company-scoped Phase 4 policy without weakening guards', () => {
  const rules = read('services/auth-service/routes/attendanceRulesRoutes.js');
  const gateway = read('services/api-gateway/routes/admin.js');
  const service = read('apps/web/src/features/admin/services/adminService.js');
  const page = read('apps/web/src/features/admin/pages/AttendanceRulesPage.jsx');
  assert.match(rules, /router\.get\('\/attendance\/absence-policy'/);
  assert.match(rules, /router\.put\('\/attendance\/absence-policy'/);
  assert.match(rules, /requireRulesAdmin\(ctx, res\)/);
  assert.match(rules, /Only super admins can configure automatic absence handling/);
  assert.match(rules, /upsert\(\{ \...policy, company_id: ctx\.companyId/);
  assert.match(rules, /absenceDeductionsV1Enabled: savedPolicy\.enabled === true/);
  assert.match(rules, /DEDUCT_LEAVE requires a valid leave_type/);
  assert.match(rules, /DEDUCT_LEAVE requires deduction_days greater than zero/);
  assert.match(gateway, /attendance\/absence-policy/);
  assert.match(service, /getAttendanceAbsencePolicy/);
  assert.match(service, /saveAttendanceAbsencePolicy/);
  assert.match(page, /Absence deductions/);
  assert.match(page, /DEDUCT_LEAVE/);
  assert.match(page, /CAP_AT_ZERO_UNPAID/);
  assert.match(page, /Approved retroactive leave can reconcile/);
});

test('web user deletion reuses the guarded mobile deletion path', () => {
  const authRoutes = read('services/auth-service/routes/auth.js');
  const gateway = read('services/api-gateway/routes/auth.js');
  const service = read('apps/web/src/features/admin/services/adminService.js');
  const page = read('apps/web/src/features/admin/pages/UsersPage.jsx');
  assert.match(authRoutes, /router\.delete\('\/users\/:uid'/);
  assert.match(authRoutes, /rejectSelfAdministrativeChange\(requester, uid, res\)/);
  assert.match(authRoutes, /requirePermission\(supabase, requester, 'delete_user', res\)/);
  assert.match(authRoutes, /\.eq\('company_id', companyId\)/);
  assert.match(authRoutes, /targetUser\.role === 'super_admin'/);
  assert.match(authRoutes, /action: 'user_deleted'/);
  assert.match(gateway, /router\.delete\('\/users\/:uid'/);
  assert.match(service, /api\.delete\(apiUrl\(`\/api\/auth\/users\//);
  assert.match(page, /user\?\.role === 'super_admin'/);
  assert.match(page, /target\.uid === user\?\.uid/);
  assert.match(page, /u\.uid !== user\?\.uid/);
  assert.match(page, /target\.role === 'super_admin'/);
  assert.match(page, /activeUser\.role !== 'super_admin'/);
  assert.match(page, /<Dialog/);
  assert.match(page, /Delete user\?/);
  assert.match(page, /setDeleteBusy\(true\)/);
});

test('manager and super-admin accounts retain employee self-service paths', () => {
  const catalog = read('shared/permissions/catalog.cjs');
  const adminRoutes = read('services/auth-service/routes/admin.js');
  const attendanceRules = read('services/auth-service/routes/attendanceRulesRoutes.js');
  const opsRoutes = read('services/auth-service/routes/opsRoutes.js');
  const mobileNavigator = read('apps/mobile/core/navigation/MainNavigator.js');
  const mobileDrawer = read('apps/mobile/shared/components/CustomDrawer.js');
  const mobileCalendar = read('apps/mobile/screens/CalendarScreen.js');
  const mobileEmployeeDashboard = read('apps/mobile/screens/EmployeeDashboard.js');
  const mobileEmployees = read('apps/mobile/utils/employees.js');
  const mobileStorage = read('apps/mobile/utils/storage.js');
  const mobileAuthScreen = read('apps/mobile/screens/AuthenticationScreen.js');
  const finalizer = read('services/auth-service/lib/attendanceFinalizer.js');
  const authRoutes = read('services/auth-service/routes/auth.js');
  const gatewayAuth = read('services/api-gateway/routes/auth.js');
  assert.match(catalog, /EMPLOYEE_BASELINE_ROLES/);
  assert.match(catalog, /isEmployeeLikeRole/);
  assert.match(adminRoutes, /const isEmployee = isEmployeeLikeRole\(requester\)/);
  assert.match(adminRoutes, /if \(!isOwnRequest\)/);
  assert.match(attendanceRules, /const own = isEmployeeLikeRole\(ctx\.requester\)/);
  assert.match(opsRoutes, /if \(!isEmployeeLikeRole\(requester\) &&/);
  assert.match(mobileNavigator, /\{isEmployeeLikeRole\(user\) &&/);
  assert.match(mobileNavigator, /ROUTES\.AUTHENTICATION_SCREEN/);
  assert.match(mobileDrawer, /employeeSelfServiceItems/);
  assert.match(mobileCalendar, /selfServiceLeaveOnly/);
  assert.match(mobileCalendar, /canCreateEvent/);
  assert.match(mobileEmployeeDashboard, /ownOnly: true/);
  assert.match(mobileEmployees, /getWorkModeRequests = async \(user = null, \{ ownOnly = false \}/);
  assert.match(mobileStorage, /attendanceWriteLocks/);
  assert.match(mobileStorage, /getOfflineQueuedRecordsForUser/);
  assert.match(mobileAuthScreen, /deriveSelfServiceAttendanceState/);
  assert.match(finalizer, /resolveSelfServiceAttendanceState/);
  assert.match(finalizer, /featureEnabled\(company\) \? await loadRules/);
  assert.match(authRoutes, /attendance\/self-state/);
  assert.match(gatewayAuth, /attendance\/self-state/);
});

test('web self-service routes are own-scoped and dashboard queue reads are bounded', () => {
  const router = read('apps/web/src/core/router/AppRouter.jsx');
  const nav = read('apps/web/src/shared/components/navConfig.jsx');
  const selfService = read('apps/web/src/features/admin/pages/SelfServicePage.jsx');
  const adminService = read('apps/web/src/features/admin/services/adminService.js');
  const adminRoutes = read('services/auth-service/routes/admin.js');
  const opsRoutes = read('services/auth-service/routes/opsRoutes.js');
  const workflowRoutes = read('services/auth-service/routes/workflowRoutes.js');
  const authRoutes = read('services/auth-service/routes/auth.js');
  const dashboard = read('apps/web/src/features/admin/pages/DashboardPage.jsx');
  assert.match(router, /path="my-attendance"/);
  assert.match(router, /path="my-leaves"/);
  assert.match(router, /path="my-work-modes"/);
  assert.match(router, /path="my-tickets"/);
  assert.match(router, /path="my-calendar"/);
  assert.match(nav, /label: 'My attendance'/);
  assert.match(nav, /label: 'My work modes'/);
  assert.match(selfService, /getAttendance\(\{ scope: 'own' \}\)/);
  assert.match(selfService, /getLeaves\(\{ scope: 'own' \}\)/);
  assert.match(selfService, /getMyWorkModeRequests/);
  assert.match(adminService, /getWorkModeRequestSummary/);
  assert.match(adminRoutes, /const ownScope = String\(req\.query\.scope/);
  assert.match(opsRoutes, /if \(ownScope \|\| \(isEmployee && !hasTicketGrant\)\)/);
  assert.match(workflowRoutes, /summaryOnly/);
  assert.match(workflowRoutes, /requester\.role !== ROLES\.SUPER_ADMIN/);
  assert.match(authRoutes, /work_mode_requests'[\s\S]*eq\('company_id', requester\.company_id\)/);
  assert.match(dashboard, /getWorkModeRequestSummary/);
  assert.doesNotMatch(dashboard, /canViewWorkModes \? adminService\.getWorkModeRequests\(\)/);
});

test('admin authorization work is request-cached without crossing requester boundaries', async () => {
  const { attachPermissionCache, hasPermission, hasAnyPermission } = require('../lib/permissions');
  const calls = {};
  const supabase = {
    from(table) {
      calls[table] = (calls[table] || 0) + 1;
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve, reject) => Promise.resolve({
          data: table === 'permission_grants'
            ? [{ permission_key: 'view_attendance', granted: true, scope_type: 'COMPANY', department_id: null }]
            : [],
          error: null,
        }).then(resolve, reject),
      };
      return builder;
    },
  };
  const first = attachPermissionCache({ uid: 'manager-1', role: 'manager', company_id: 'company-1' });
  assert.equal(await hasPermission(supabase, first, 'view_attendance'), true);
  assert.equal(await hasAnyPermission(supabase, { ...first }, ['view_attendance', 'view_leave_requests']), true);
  assert.equal(calls.permission_grants, 1);
  assert.equal(calls.manager_permissions, 1);

  const second = attachPermissionCache({ uid: 'manager-2', role: 'manager', company_id: 'company-1' });
  await hasPermission(supabase, second, 'view_attendance');
  assert.equal(calls.permission_grants, 2);
  assert.equal(calls.manager_permissions, 2);

  const otherTenant = attachPermissionCache({ uid: 'manager-1', role: 'manager', company_id: 'company-2' });
  await hasPermission(supabase, otherTenant, 'view_attendance');
  assert.equal(calls.permission_grants, 3);
  assert.equal(calls.manager_permissions, 3);
});

test('dashboard admin routes reuse request auth context and batch leave subjects', () => {
  const permissions = read('services/auth-service/lib/permissions.js');
  const adminRoutes = read('services/auth-service/routes/admin.js');
  const opsRoutes = read('services/auth-service/routes/opsRoutes.js');
  assert.match(permissions, /REQUEST_AUTHZ_CACHE/);
  assert.match(permissions, /scopedUsers/);
  assert.match(adminRoutes, /attachPermissionCache\(await resolveRequester\(req\)\)/);
  assert.match(adminRoutes, /subjectByUid = new Map/);
  assert.match(adminRoutes, /enrichLeaveRequestsWithEmployees\(supabase, companyId, visible, \{ users: companyUsers \|\| \[\] \}\)/);
  assert.match(opsRoutes, /attachPermissionCache\(user\)/);
});
