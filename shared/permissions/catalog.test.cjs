/**
 * Authorization catalog tests.
 * Run: node --test shared/permissions/catalog.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_MANAGER_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  canAccessFeature,
  isSuperAdmin,
} = require('./catalog.cjs');

const employee = { role: 'employee', permissions: [] };
const managerNoPerm = { role: 'manager', permissions: [] };
const managerGeo = { role: 'manager', permissions: ['manage_geofencing'] };
const superAdmin = { role: 'super_admin' };

test('employee has no admin permissions but receives only employee web features', () => {
  assert.equal(hasPermission(employee, 'manage_geofencing'), false);
  assert.equal(canAccessFeature(employee, 'sites'), false);
  for (const feature of ['attendance', 'leaves', 'tickets', 'calendar', 'notifications']) {
    assert.equal(canAccessFeature(employee, feature), true);
  }
  assert.equal(canAccessFeature(employee, 'users'), false);
  assert.equal(isSuperAdmin(employee), false);
});

test('manager needs the explicit grant', () => {
  assert.equal(hasPermission(managerNoPerm, 'manage_geofencing'), false);
  assert.equal(canAccessFeature(managerNoPerm, 'sites'), false);
  assert.equal(hasPermission(managerGeo, 'manage_geofencing'), true);
  assert.equal(canAccessFeature(managerGeo, 'sites'), true);
});

test('super_admin bypasses the catalog', () => {
  assert.equal(hasPermission(superAdmin, 'manage_geofencing'), true);
  assert.equal(canAccessFeature(superAdmin, 'sites'), true);
  assert.equal(isSuperAdmin(superAdmin), true);
});

test('unknown permission keys are rejected', () => {
  assert.equal(hasPermission(managerGeo, 'not_a_real_key'), false);
  assert.equal(hasAnyPermission(managerGeo, ['not_a_real_key']), false);
});

test('null / undefined user is denied', () => {
  assert.equal(hasPermission(null, 'manage_geofencing'), false);
  assert.equal(canAccessFeature(undefined, 'sites'), false);
});

test('employee can receive an explicit delegated capability without changing system role', () => {
  const delegated = {
    role: 'employee',
    permissions: ['view_employees'],
    grants: [{ permission_key: 'view_employees', granted: true, scope_type: 'DEPARTMENT' }],
  };
  assert.equal(hasPermission(delegated, 'view_employees'), true);
  assert.equal(canAccessFeature(delegated, 'users'), true);
});

test('catalog includes permission keys used by workflow and leave administration', () => {
  assert.deepEqual(
    [
      'create_leave_request',
      'view_work_mode_requests',
      'approve_work_mode',
      'reject_work_mode',
      'manage_approval_workflows',
    ].filter((key) => ALL_MANAGER_PERMISSIONS.includes(key)),
    [
      'create_leave_request',
      'view_work_mode_requests',
      'approve_work_mode',
      'reject_work_mode',
      'manage_approval_workflows',
    ]
  );
});
