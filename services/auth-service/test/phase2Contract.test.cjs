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
