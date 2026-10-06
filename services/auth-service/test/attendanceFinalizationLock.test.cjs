const test = require('node:test');
const assert = require('node:assert/strict');
const { withAttendanceFinalizationLock } = require('../lib/attendanceFinalizationLock');

function lockDb() {
  const owners = new Map();
  return {
    owners,
    rpc(name, args) {
      const key = `${args.p_company_id}:${args.p_work_date}:${args.p_mode}`;
      if (name === 'try_acquire_attendance_finalization_lock') {
        if (owners.has(key)) return Promise.resolve({ data: false, error: null });
        owners.set(key, args.p_owner_token);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'renew_attendance_finalization_lock') {
        return Promise.resolve({ data: owners.get(key) === args.p_owner_token, error: null });
      }
      if (name === 'release_attendance_finalization_lock') {
        const owns = owners.get(key) === args.p_owner_token;
        if (owns) owners.delete(key);
        return Promise.resolve({ data: owns, error: null });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

test('worker A acquires and worker B cannot process the same company/date/mode', async () => {
  const db = lockDb();
  let releaseA;
  const workerA = withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, () => new Promise((resolve) => { releaseA = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const workerB = await withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, async () => 'must-not-run');
  assert.equal(workerB.skipped, true);
  releaseA('done');
  const resultA = await workerA;
  assert.equal(resultA.result, 'done');
  assert.equal(db.owners.size, 0);
});

test('different company/date keys can process concurrently', async () => {
  const db = lockDb();
  const [a, b] = await Promise.all([
    withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, async () => 'a'),
    withAttendanceFinalizationLock(db, { companyId: 'b', workDate: '2026-10-07', mode: 'active' }, async () => 'b'),
  ]);
  assert.equal(a.result, 'a');
  assert.equal(b.result, 'b');
  assert.equal(db.owners.size, 0);
});

test('lock releases after success and failure so retries remain possible', async () => {
  const db = lockDb();
  const success = await withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, async () => 'ok');
  assert.equal(success.result, 'ok');
  await assert.rejects(() => withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, async () => { throw new Error('failed run'); }));
  const retry = await withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'active' }, async () => 'retry');
  assert.equal(retry.result, 'retry');
  assert.equal(db.owners.size, 0);
});

test('observe mode uses the same scoped lock without attendance mutation', async () => {
  const db = lockDb();
  let mutations = 0;
  const result = await withAttendanceFinalizationLock(db, { companyId: 'a', workDate: '2026-10-06', mode: 'observe' }, async () => {
    mutations += 1;
    return { enabled: false, observe_only: true };
  });
  assert.deepEqual(result.result, { enabled: false, observe_only: true });
  assert.equal(mutations, 1);
  assert.equal(db.owners.size, 0);
});
