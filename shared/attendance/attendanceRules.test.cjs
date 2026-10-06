const test = require('node:test');
const assert = require('node:assert/strict');
const {
  zonedInstant,
  resolveEffectiveRule,
  resolveScheduleWindow,
  pairAttendanceRecords,
  calculateDailySummary,
} = require('./attendanceRules.cjs');

const base = (overrides = {}) => ({
  id: 'company-rule', version: 1, company_id: 'company-a', scope_type: 'COMPANY', timezone: 'UTC',
  scheduled_start: '09:00', scheduled_end: '18:00', grace_minutes: 15,
  working_days: [1, 2, 3, 4, 5], overtime_enabled: true, overtime_window_minutes: 120,
  auto_checkout_enabled: true, effective_from: '2026-01-01', ...overrides,
});

const record = (id, type, timestamp, extra = {}) => ({ id, type, timestamp, company_id: 'company-a', user_uid: 'user-a', ...extra });

test('rule precedence is user then department then company', () => {
  const rules = [base(), base({ id: 'department', scope_type: 'DEPARTMENT', department_id: 'dept-a' }), base({ id: 'user', scope_type: 'USER', user_uid: 'user-a' })];
  assert.equal(resolveEffectiveRule(rules, { uid: 'user-a', primary_department_id: 'dept-a' }, 'company-a', '2026-02-01').id, 'user');
  assert.equal(resolveEffectiveRule(rules.slice(0, 2), { uid: 'user-b', primary_department_id: 'dept-a' }, 'company-a', '2026-02-01').id, 'department');
  assert.equal(resolveEffectiveRule([rules[0]], { uid: 'user-b', primary_department_id: 'dept-b' }, 'company-a', '2026-02-01').id, 'company-rule');
});

test('effective-date boundaries are inclusive', () => {
  const rules = [base({ id: 'old', effective_to: '2026-02-28' }), base({ id: 'new', effective_from: '2026-03-01', scheduled_start: '10:00' })];
  assert.equal(resolveEffectiveRule(rules, { uid: 'u' }, 'company-a', '2026-02-28').id, 'old');
  assert.equal(resolveEffectiveRule(rules, { uid: 'u' }, 'company-a', '2026-03-01').id, 'new');
});

test('overnight schedule ends on the following local day', () => {
  const window = resolveScheduleWindow(base({ scheduled_start: '22:00', scheduled_end: '06:00' }), '2026-02-01');
  assert.equal(window.start.toISOString(), '2026-02-01T22:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-02-02T06:00:00.000Z');
});

test('DST spring-forward and fall-back resolve to valid instants', () => {
  const spring = zonedInstant('2026-03-08', '02:30', 'America/New_York');
  const fall = zonedInstant('2026-11-01', '01:30', 'America/New_York');
  assert.equal(Number.isNaN(spring.getTime()), false);
  assert.equal(Number.isNaN(fall.getTime()), false);
  assert.equal(spring.toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(fall.toISOString(), '2026-11-01T05:30:00.000Z');
});

test('late arrival and overtime are independent', () => {
  const result = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T10:00:00Z'), record('out', 'checkout', '2026-02-02T19:00:00Z')] });
  assert.equal(result.late_seconds, 45 * 60);
  assert.equal(result.worked_seconds, 9 * 60 * 60);
  assert.equal(result.regular_seconds, 9 * 60 * 60);
  assert.equal(result.overtime_seconds, 60 * 60);
});

test('early checkout produces no overtime', () => {
  const result = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:00:00Z'), record('out', 'checkout', '2026-02-02T16:00:00Z')] });
  assert.equal(result.worked_seconds, 7 * 60 * 60);
  assert.equal(result.regular_seconds, 7 * 60 * 60);
  assert.equal(result.overtime_seconds, 0);
});

test('weekly off, holiday, working holiday, and approved leave do not become absence', () => {
  const off = calculateDailySummary({ rule: base(), workDate: '2026-02-07', records: [] });
  const holiday = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [], holiday: { id: 'h', is_working_day: false } });
  const workingHoliday = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [], holiday: { id: 'h', is_working_day: true } });
  const leave = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [], leave: { id: 'l' } });
  assert.equal(off.status, 'WEEKLY_OFF'); assert.equal(off.absence_eligible, false);
  assert.equal(holiday.status, 'HOLIDAY'); assert.equal(holiday.absence_eligible, false);
  assert.equal(workingHoliday.status, 'ABSENT'); assert.equal(workingHoliday.absence_eligible, true);
  assert.equal(leave.status, 'ON_LEAVE'); assert.equal(leave.absence_eligible, false);
});

test('missing checkout remains open before deadline and scheduled checkout creates no overtime', () => {
  const records = [record('in', 'checkin', '2026-02-02T09:00:00Z')];
  const open = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records, now: '2026-02-02T19:00:00Z' });
  assert.equal(open.status, 'OPEN');
  const synthetic = { ...record('auto', 'checkout', '2026-02-02T18:00:00Z'), checkout_source: 'automatic_schedule' };
  const closed = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records, syntheticCheckout: synthetic, now: '2026-02-02T21:00:00Z' });
  assert.equal(closed.status, 'AUTO_CHECKED_OUT');
  assert.equal(closed.overtime_seconds, 0);
});

test('a future/current working day is not marked absent before its deadline', () => {
  const result = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [], now: '2026-02-02T08:00:00Z' });
  assert.equal(result.status, 'OPEN');
  assert.equal(result.absence_eligible, false);
});

test('multiple sessions are paired and invalid events are surfaced', () => {
  const result = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [
    record('in1', 'checkin', '2026-02-02T09:00:00Z'), record('out1', 'checkout', '2026-02-02T12:00:00Z'),
    record('bad', 'checkout', '2026-02-02T12:30:00Z'), record('in2', 'checkin', '2026-02-02T13:00:00Z'), record('out2', 'checkout', '2026-02-02T18:00:00Z'),
  ] });
  assert.equal(result.worked_seconds, 8 * 60 * 60);
  assert.equal(result.invalid_events.length, 1);
});

test('cross-company rules do not resolve', () => {
  assert.equal(resolveEffectiveRule([base({ company_id: 'company-b' })], { uid: 'u' }, 'company-a', '2026-02-01'), null);
});

test('automatic geofence checkout remains overtime-capable while scheduled checkout is not', () => {
  const geofence = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:00:00Z'), record('out', 'checkout', '2026-02-02T19:00:00Z', { checkout_source: 'automatic_geofence' })] });
  const scheduled = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:00:00Z'), record('out', 'checkout', '2026-02-02T18:00:00Z', { checkout_source: 'automatic_schedule' })] });
  assert.equal(geofence.overtime_seconds, 60 * 60);
  assert.equal(geofence.checkout_source, 'automatic_geofence');
  assert.equal(scheduled.overtime_seconds, 0);
});

test('manual and offline checkout already present wins over scheduled checkout', () => {
  const manual = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:00:00Z'), record('manual', 'checkout', '2026-02-02T17:59:00Z', { is_manual: true, checkout_source: 'manual' })], now: '2026-02-02T21:00:00Z' });
  const offline = calculateDailySummary({ rule: base(), workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:00:00Z'), record('offline', 'checkout', '2026-02-02T17:59:00Z', { auth_method: 'mobile_offline_sync' })], now: '2026-02-02T21:00:00Z' });
  assert.equal(manual.checkout_source, 'manual');
  assert.equal(manual.status, 'PRESENT');
  assert.equal(offline.status, 'PRESENT');
  assert.equal(offline.overtime_seconds, 0);
});

test('manual correction supersedes a scheduled checkout without deleting raw events', () => {
  const result = calculateDailySummary({
    rule: base(),
    workDate: '2026-02-02',
    records: [
      record('in', 'checkin', '2026-02-02T09:00:00Z'),
      record('auto', 'checkout', '2026-02-02T18:00:00Z', { checkout_source: 'automatic_schedule' }),
      record('correction', 'checkout', '2026-02-02T18:30:00Z', { is_manual: true, checkout_source: 'manual' }),
    ],
    now: '2026-02-02T21:00:00Z',
  });
  assert.equal(result.checkout.id, 'correction');
  assert.equal(result.checkout_source, 'manual');
  assert.equal(result.status, 'PRESENT');
});

test('schedule snapshot values can be reused after rule changes', () => {
  const snapshotRule = base({ id: 'rule-v1', version: 1, scheduled_start: '09:00' });
  const changedRule = base({ id: 'rule-v2', version: 2, scheduled_start: '10:00' });
  const first = calculateDailySummary({ rule: snapshotRule, workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:30:00Z'), record('out', 'checkout', '2026-02-02T18:00:00Z')] });
  const later = calculateDailySummary({ rule: changedRule, workDate: '2026-02-02', records: [record('in', 'checkin', '2026-02-02T09:30:00Z'), record('out', 'checkout', '2026-02-02T18:00:00Z')] });
  assert.equal(first.late_seconds, 15 * 60);
  assert.equal(later.late_seconds, 0);
});
