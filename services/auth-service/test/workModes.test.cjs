/**
 * Run: node --test services/auth-service/test/workModes.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWorkMode, isValidWorkMode } = require('../lib/workModes');

test('normalizeWorkMode maps UI labels and aliases to DB-safe values', () => {
  assert.equal(normalizeWorkMode('In-office'), 'in_office');
  assert.equal(normalizeWorkMode('office'), 'in_office');
  assert.equal(normalizeWorkMode('Hybrid'), 'semi_remote');
  assert.equal(normalizeWorkMode('semi_remote'), 'semi_remote');
  assert.equal(normalizeWorkMode('Remote'), 'fully_remote');
  assert.equal(normalizeWorkMode('fully_remote'), 'fully_remote');
});

test('isValidWorkMode accepts only normalized DB values and known aliases', () => {
  assert.equal(isValidWorkMode('remote'), true);
  assert.equal(isValidWorkMode('semi_remote'), true);
  assert.equal(isValidWorkMode('fully_remote'), true);
  assert.equal(isValidWorkMode('somewhere_else'), false);
});
