const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyAttendanceWriteError,
  isDesiredStateSatisfied,
  hasQueueIdentity,
  queueIdentityMatches,
} = require('./mobileQueuePolicy.cjs');

test('attendance queue classifies deterministic server failures as terminal', () => {
  assert.equal(classifyAttendanceWriteError({ status: 409, message: 'already checked in' }), 'terminal');
  assert.equal(classifyAttendanceWriteError({ code: '42501', message: 'permission denied' }), 'terminal');
  assert.equal(classifyAttendanceWriteError({ status: 401, message: 'expired session' }), 'terminal');
});

test('attendance queue classifies genuine connectivity failures as retryable', () => {
  assert.equal(classifyAttendanceWriteError(new TypeError('Network request failed')), 'network');
  assert.equal(classifyAttendanceWriteError({ name: 'AbortError', message: 'request timeout' }), 'network');
  assert.equal(classifyAttendanceWriteError({ code: 'ECONNRESET' }), 'network');
});

test('authoritative state confirms completed check-in and checkout writes', () => {
  assert.equal(isDesiredStateSatisfied('checkin', { can_check_out: true }), true);
  assert.equal(isDesiredStateSatisfied('checkin', { completed: true, can_check_out: false }), false);
  assert.equal(isDesiredStateSatisfied('checkout', { completed: true }), true);
  assert.equal(isDesiredStateSatisfied('checkout', { canCheckOut: false, lastRecord: { type: 'checkout' } }), true);
  assert.equal(isDesiredStateSatisfied('checkin', { can_check_in: true, can_check_out: false }), false);
});

test('queue identity is required and tenant-bound', () => {
  const record = { user_uid: 'user-a', company_id: 'company-a' };
  assert.equal(hasQueueIdentity(record), true);
  assert.equal(queueIdentityMatches(record, 'user-a', 'company-a'), true);
  assert.equal(queueIdentityMatches(record, 'user-b', 'company-a'), false);
  assert.equal(queueIdentityMatches(record, 'user-a', 'company-b'), false);
  assert.equal(hasQueueIdentity({ username: 'legacy-user' }), false);
});
