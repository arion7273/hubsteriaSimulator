import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateScope, TARGET, FACILITY } from '../src/policy.mjs';
import { parseGiveTestId } from '../src/data.mjs';

const config = {
  target: TARGET,
  facilityName: FACILITY,
  facilityId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  users: ['caregiver-1', 'caregiver-2'],
  rounds: 2,
  pauseMs: 2000,
  maxPageMs: 10000,
  maxActionMs: 45000,
  scenarios: ['navigation', 'medication'],
};

test('rejects unauthorized targets and facility names', () => {
  assert.throws(() => validateConfig({ ...config, target: 'https://other.example/app' }));
  assert.throws(() => validateConfig({ ...config, facilityName: 'Real facility' }));
  assert.equal(validateConfig(config), config);
});

test('rejects all-facilities scope, wrong org, missing server proof and mismatched names', () => {
  const scope = { organizationId: config.organizationId, facilityId: config.facilityId };
  const rows = [{ id: config.facilityId, name: FACILITY }];
  validateScope(config, scope, rows);
  assert.throws(() => validateScope(config, { ...scope, facilityId: 'all' }, rows));
  assert.throws(() => validateScope(config, { ...scope, organizationId: 'other' }, rows));
  assert.throws(() => validateScope(config, scope, null));
  assert.throws(() => validateScope(config, scope, [{ id: config.facilityId, name: 'Other' }]));
});

test('bounds concurrency and run length', () => {
  assert.throws(() => validateConfig({ ...config, users: ['one', 'one'] }));
  assert.throws(() => validateConfig({ ...config, rounds: 100 }));
  assert.throws(() => validateConfig({ ...config, pauseMs: 0 }));
  assert.throws(() => validateConfig({ ...config, scenarios: ['medication', 'unknown'] }));
});

test('parses charting sheet give test ids', () => {
  const orderId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const scheduled = '2026-10-08T15:30:00.000Z';
  const parsed = parseGiveTestId(`charting-sheet-med-give-${orderId}-${scheduled}`);
  assert.equal(parsed.orderId, orderId);
  assert.equal(parsed.scheduledFor, scheduled);
});
