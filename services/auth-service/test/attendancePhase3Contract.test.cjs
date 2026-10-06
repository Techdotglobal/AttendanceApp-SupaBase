const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Phase 3 migration is additive and preserves raw attendance', () => {
  const migration = read('supabase/migrations/20261005120000_attendance_rules_v1.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS app_settings jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.attendance_records[\s\S]{0,500}SET NOT NULL/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_daily_summaries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_schedule_rules/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_holidays/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_scheduled_attendance_checkout/);
  assert.doesNotMatch(migration, /UPDATE\s+(?:public\.)?attendance_records\s+SET\s+(?:type|timestamp|status)/i);
  assert.match(migration, /attendance_records_one_scheduled_checkout/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('database guards cover tenant-local schedule and summary references', () => {
  const migration = read('supabase/migrations/20261005120000_attendance_rules_v1.sql');
  for (const phrase of [
    'attendance schedule department must belong to its company',
    'attendance schedule user must belong to its company',
    'summary schedule rule must belong to its company',
    'summary check-in must belong to its company and user',
    'summary checkout must belong to its company and user',
    'summary holiday must belong to its company',
    'summary leave request must belong to its company and user',
    'automatic checkout check-in must belong to its company and user',
    'automatic checkout parent must be a check-in',
  ]) assert.match(migration, new RegExp(phrase));
  assert.match(migration, /scheduled metadata is server-managed/);
  assert.match(migration, /attendance daily schedule snapshot is immutable/);
});

test('schedule snapshot is persisted and reused by the finalizer', () => {
  const finalizer = read('services/auth-service/lib/attendanceFinalizer.js');
  assert.match(finalizer, /calculation_snapshot/);
  assert.match(finalizer, /ruleFromSnapshot\(summary\.calculation_snapshot\)/);
  assert.match(finalizer, /Another worker may have won the first-context race/);
});

test('legacy mobile direct writes, offline queue, and geofence checkout remain present', () => {
  const storage = read('apps/mobile/utils/storage.js');
  const geofence = read('apps/mobile/features/geofencing/services/locationMonitoringService.js');
  assert.match(storage, /from\('attendance_records'\)/);
  assert.match(storage, /saveAttendanceRecordFallback/);
  assert.match(geofence, /automatic_geofence/);
  assert.match(geofence, /saveAttendanceRecord/);
});

test('payroll and reporting continue consuming raw attendance records', () => {
  assert.match(read('services/auth-service/routes/payroll.js'), /from\('attendance_records'\)/);
  assert.match(read('services/reporting-service/services/queryService.js'), /from\('attendance_records'\)/);
  assert.match(read('services/reporting-service/services/reportMetrics.js'), /attendanceRecords/);
});

test('observe-only scheduler mode is explicit and non-mutating at the scheduler boundary', () => {
  const job = read('services/reporting-service/jobs/attendanceFinalizationJob.js');
  assert.match(job, /ATTENDANCE_FINALIZER_MODE \|\| 'observe'/);
  assert.match(job, /mode\)/);
  assert.match(job, /api\/internal\/attendance\/finalize/);
  assert.doesNotMatch(job, /from\('attendance_records'\)/);
  assert.match(job, /\[-1, 0, 1\]/);
});

test('finalization uses a distributed company/date/mode lock and preserves run tracking', () => {
  const migration = read('supabase/migrations/20261006100000_attendance_finalization_lock.sql');
  const route = read('services/auth-service/routes/attendanceInternalRoutes.js');
  assert.match(migration, /PRIMARY KEY \(company_id, work_date, mode\)/);
  assert.match(migration, /try_acquire_attendance_finalization_lock/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /release_attendance_finalization_lock/);
  assert.match(route, /withAttendanceFinalizationLock/);
  assert.match(route, /attendance_finalization_runs/);
  assert.match(route, /status: 'failed'/);
  assert.match(route, /reason: 'locked'/);
});

test('Phase 3 configuration is backend-administered and scoped summaries reuse centralized authorization', () => {
  const migration = read('supabase/migrations/20261005120000_attendance_rules_v1.sql');
  const routes = read('services/auth-service/routes/attendanceRulesRoutes.js');
  const permissions = read('services/auth-service/lib/permissions.js');
  assert.doesNotMatch(migration, /CREATE POLICY attendance_schedule_rules_same_company_read/);
  assert.doesNotMatch(migration, /CREATE POLICY attendance_holidays_same_company_read/);
  assert.match(routes, /requireRulesAdmin\(ctx, res\)/);
  assert.match(routes, /resolveScopedUserUids/);
  assert.match(permissions, /async function resolveScopedUserUids/);
});

test('internal finalization applies the feature flag before explicit company selection or run writes', () => {
  const routes = read('services/auth-service/routes/attendanceInternalRoutes.js');
  assert.match(routes, /requestedCompanyId/);
  assert.match(routes, /enabledCompanies/);
  assert.match(routes, /Always apply the tenant feature flag/);
  assert.match(routes, /companyIds = enabledCompanies/);
});

test('finalizer preserves the loaded primary department and avoids historical context creation', () => {
  const finalizer = read('services/auth-service/lib/attendanceFinalizer.js');
  assert.match(finalizer, /primary_department_id: user\.primary_department_id \|\| user\.department_id/);
  assert.match(finalizer, /historicalWithoutContext/);
  assert.match(finalizer, /futureWithoutContext/);
  assert.match(finalizer, /persistedScheduleWindow/);
  assert.match(finalizer, /String\(row\.employee_uid\) === String\(userUid\)/);
  assert.match(finalizer, /Legacy attendance rows can have a NULL company_id/);
});
