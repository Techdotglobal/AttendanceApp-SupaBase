const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveApproversForStep,
  canUserActOnStep,
} = require('../lib/approvalEngine');

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

function makeSupabase({ users, grants = [], assignments = [], legacyPermissions = [], stats = null }) {
  const tables = { users, permission_grants: grants, user_department_assignments: assignments, manager_permissions: legacyPermissions, departments: [] };
  return {
    from(table) {
      if (stats) stats[table] = (stats[table] || 0) + 1;
      const state = { rows: tables[table] || [], filters: [] };
      const query = {
        select() { return query; },
        eq(column, value) { state.filters.push({ column, value, op: 'eq' }); return query; },
        is(column, value) { state.filters.push({ column, value, op: 'is' }); return query; },
        ilike(column, value) { state.filters.push({ column, value: String(value).toLowerCase(), op: 'ilike' }); return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle: async () => ({ data: filterRows(state)[0] || null, error: null }),
        single: async () => ({ data: filterRows(state)[0] || null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: filterRows(state), error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

function filterRows(state) {
  return state.rows.filter((row) => state.filters.every((filter) => {
    const actual = row[filter.column];
    if (filter.op === 'is') return actual === filter.value;
    if (filter.op === 'ilike') return String(actual || '').toLowerCase() === String(filter.value).toLowerCase();
    return String(actual) === String(filter.value);
  }));
}

function fixture({ approver, targetDepartments = ['dept-eng'], grant, approverAssignments = targetDepartments, stats = null }) {
  const target = { uid: 'employee-1', company_id: COMPANY_A, role: 'employee', is_active: true, department_id: targetDepartments[0], department: 'Engineering' };
  const users = [target, { ...approver, company_id: approver.company_id || COMPANY_A, is_active: approver.is_active !== false }];
  const assignments = [
    ...targetDepartments.map((department_id) => ({ user_uid: target.uid, department_id, is_active: true })),
    ...approverAssignments.map((department_id) => ({ user_uid: approver.uid, department_id, is_active: true })),
  ];
  return makeSupabase({ users, assignments, stats, grants: grant ? [{ principal_uid: approver.uid, company_id: approver.company_id || COMPANY_A, granted: true, ...grant }] : [] });
}

test('legacy manager approval remains department-compatible', async () => {
  const supabase = fixture({
    approver: { uid: 'manager-1', role: 'manager', department_id: 'dept-eng', department: 'Engineering' },
  });
  const result = await resolveApproversForStep(supabase, { authority_type: 'LEGACY_ROLE', approver_role: 'department_manager' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(result.map((user) => user.uid), ['manager-1']);
});

test('permission-only authority honors department scope and rejects wrong departments', async () => {
  const supabase = fixture({
    approver: { uid: 'approver-1', role: 'employee', department_id: 'dept-hr' },
    grant: { permission_key: 'approve_leave', scope_type: 'DEPARTMENT', department_id: 'dept-eng' },
  });
  const step = { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'DEPARTMENT', department_id: 'dept-eng' };
  const result = await resolveApproversForStep(supabase, step, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(result.map((user) => user.uid), ['approver-1']);
  const wrongDepartment = await resolveApproversForStep(supabase, { ...step, department_id: 'dept-finance' }, 'employee-1', COMPANY_A, 'dept-finance', 'annual_leave');
  assert.deepEqual(wrongDepartment, []);
});

test('assigned-department and company scopes resolve correctly', async () => {
  const assigned = fixture({
    approver: { uid: 'approver-assigned', role: 'employee' },
    grant: { permission_key: 'approve_leave', scope_type: 'ASSIGNED_DEPARTMENTS', department_id: null },
    approverAssignments: ['dept-eng', 'dept-finance'],
  });
  const assignedResult = await resolveApproversForStep(assigned, { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'ASSIGNED_DEPARTMENTS' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(assignedResult.map((user) => user.uid), ['approver-assigned']);

  const company = fixture({
    approver: { uid: 'approver-company', role: 'employee' },
    grant: { permission_key: 'approve_leave', scope_type: 'COMPANY', department_id: null },
  });
  const companyResult = await resolveApproversForStep(company, { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'COMPANY' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(companyResult.map((user) => user.uid), ['approver-company']);
});

test('OWN scope cannot satisfy an approval authority', async () => {
  const supabase = fixture({
    approver: { uid: 'approver-own', role: 'employee' },
    grant: { permission_key: 'approve_leave', scope_type: 'OWN', department_id: null },
  });
  const result = await resolveApproversForStep(
    supabase,
    { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'OWN' },
    'employee-1',
    COMPANY_A,
    'dept-eng',
    'annual_leave'
  );
  assert.deepEqual(result, []);
});

test('organization role requires both matching role and permission', async () => {
  const supabase = fixture({
    approver: { uid: 'lead-1', role: 'employee', organization_role_id: 'role-lead' },
    grant: { permission_key: 'approve_leave', scope_type: 'DEPARTMENT', department_id: 'dept-eng' },
  });
  const step = { authority_type: 'ORGANIZATION_ROLE', organization_role_id: 'role-lead', required_permission_key: 'approve_leave', required_scope_type: 'DEPARTMENT', department_id: 'dept-eng' };
  const result = await resolveApproversForStep(supabase, step, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(result.map((user) => user.uid), ['lead-1']);
  const wrongRole = await resolveApproversForStep(supabase, { ...step, organization_role_id: 'role-other' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave');
  assert.deepEqual(wrongRole, []);
});

test('inactive, cross-company, and self approvers are rejected', async () => {
  const supabase = fixture({
    approver: { uid: 'approver-1', role: 'employee', is_active: false },
    grant: { permission_key: 'approve_leave', scope_type: 'COMPANY', department_id: null },
  });
  const step = { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'COMPANY' };
  assert.deepEqual(await resolveApproversForStep(supabase, step, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave'), []);

  const crossCompany = fixture({
    approver: { uid: 'approver-cross', role: 'employee', company_id: COMPANY_B },
    grant: { permission_key: 'approve_leave', scope_type: 'COMPANY', department_id: null },
  });
  assert.deepEqual(await resolveApproversForStep(crossCompany, step, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave'), []);

  const self = fixture({
    approver: { uid: 'employee-1', role: 'employee' },
    grant: { permission_key: 'approve_leave', scope_type: 'COMPANY', department_id: null },
  });
  assert.equal(await canUserActOnStep(self, { uid: 'employee-1', role: 'employee' }, step, 'employee-1', COMPANY_A, 'annual_leave'), false);
});

test('workflow eligibility can reuse request-scoped authorization data', async () => {
  const stats = {};
  const supabase = fixture({
    stats,
    approver: { uid: 'approver-1', role: 'manager', department_id: 'dept-eng' },
    grant: { permission_key: 'approve_leave', scope_type: 'DEPARTMENT', department_id: 'dept-eng' },
  });
  const cached = { departments: new Map(), grants: new Map(), subjects: new Map(), candidates: new Map() };
  await resolveApproversForStep(supabase, { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'DEPARTMENT', department_id: 'dept-eng' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave', { cache: cached });
  const firstUsersQueries = stats.users || 0;
  await resolveApproversForStep(supabase, { authority_type: 'PERMISSION', required_permission_key: 'approve_leave', required_scope_type: 'DEPARTMENT', department_id: 'dept-eng' }, 'employee-1', COMPANY_A, 'dept-eng', 'annual_leave', { cache: cached });
  assert.equal(stats.users || 0, firstUsersQueries);
});
