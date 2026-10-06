const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';

const config = require('../config/supabase');
const {
  ensureContext,
  persistedScheduleWindow,
  selectEventsForWindow,
} = require('../lib/attendanceFinalizer');

const rule = {
  id: 'rule-v1', version: 1, scope_type: 'COMPANY', timezone: 'UTC',
  scheduled_start: '22:00', scheduled_end: '06:00', grace_minutes: 15,
  working_days: [1, 2, 3, 4, 5], overtime_enabled: true,
  overtime_window_minutes: 120, auto_checkout_enabled: true,
};

test('first-context race reloads the winning immutable snapshot', async () => {
  const originalFrom = config.supabase.from;
  let loadCount = 0;
  let insertCount = 0;
  const winner = {
    id: 'summary-winner', user_uid: 'user-a', work_date: '2026-02-02',
    schedule_rule_id: 'rule-v2', schedule_version: 2,
    timezone: 'UTC', scheduled_start_at: '2026-02-02T10:00:00.000Z',
    scheduled_end_at: '2026-02-02T19:00:00.000Z', scheduled_duration_seconds: 32400,
    calculation_snapshot: { id: 'rule-v2', version: 2, scheduled_start: '10:00', scheduled_end: '19:00', timezone: 'UTC' },
  };
  config.supabase.from = (table) => {
    assert.equal(table, 'attendance_daily_summaries');
    const query = {
      select() { return this; },
      eq() { return this; },
      insert() { insertCount += 1; return this; },
      maybeSingle: async () => {
        loadCount += 1;
        return loadCount === 1 ? { data: null, error: null } : { data: winner, error: null };
      },
      single: async () => ({ data: null, error: { code: '23505', message: 'duplicate summary' } }),
    };
    return query;
  };
  try {
    const result = await ensureContext('company-a', { uid: 'user-a' }, '2026-02-02', rule, 'active', true);
    assert.equal(insertCount, 1);
    assert.equal(result.id, 'summary-winner');
    assert.equal(result.schedule_version, 2);
  } finally {
    config.supabase.from = originalFrom;
  }
});

test('observe mode does not create a daily context', async () => {
  const originalFrom = config.supabase.from;
  let inserts = 0;
  config.supabase.from = () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    insert() { inserts += 1; return this; },
  });
  try {
    const result = await ensureContext('company-a', { uid: 'user-a' }, '2026-02-02', rule, 'observe', true);
    assert.equal(result, null);
    assert.equal(inserts, 0);
  } finally {
    config.supabase.from = originalFrom;
  }
});

test('persisted UTC window is used instead of re-resolving changed local times', () => {
  const snapshotRule = { ...rule, scheduled_start: '10:00', scheduled_end: '19:00' };
  const summary = {
    timezone: 'UTC',
    scheduled_start_at: '2026-02-02T09:00:00.000Z',
    scheduled_end_at: '2026-02-02T18:00:00.000Z',
    scheduled_duration_seconds: 32400,
  };
  const window = persistedScheduleWindow(summary, snapshotRule, '2026-02-02');
  assert.equal(window.start.toISOString(), summary.scheduled_start_at);
  assert.equal(window.end.toISOString(), summary.scheduled_end_at);
  assert.equal(window.scheduledDurationSeconds, 32400);
});

test('overnight selection excludes an unrelated next-day check-in', () => {
  const rows = [
    { id: 'in', type: 'checkin', timestamp: '2026-02-02T22:00:00Z' },
    { id: 'out', type: 'checkout', timestamp: '2026-02-03T06:00:00Z' },
    { id: 'next-in', type: 'checkin', timestamp: '2026-02-03T22:00:00Z' },
  ];
  const selected = selectEventsForWindow(rows, '2026-02-02', {
    timezone: 'UTC', end: new Date('2026-02-03T06:00:00Z'),
  });
  assert.deepEqual(selected.map((row) => row.id), ['in', 'out']);
});
