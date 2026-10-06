const test = require('node:test');
const assert = require('node:assert/strict');

const { candidateDates } = require('./attendanceFinalizationJob');

test('scheduler covers the UTC boundary candidates without creating local future contexts itself', () => {
  assert.deepEqual(candidateDates(new Date('2026-10-05T23:30:00Z')), [
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
  ]);
});
