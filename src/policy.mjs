export const TARGET = 'https://hubsteriacare.com/app';
export const FACILITY = 'HubsteriaCare demo facility';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SCENARIOS = new Set(['navigation', 'medication', 'collision', 'adl', 'vitals', 'notes']);

export function validateConfig(c) {
  if (c.target !== TARGET || c.facilityName !== FACILITY) throw new Error('Only the authorized demo facility and target are allowed.');
  if (!uuid.test(c.facilityId) || !uuid.test(c.organizationId)) throw new Error('Configure the actual demo facility and organization UUIDs.');
  if (!Array.isArray(c.users) || c.users.length !== 2 || new Set(c.users).size !== 2 || c.users.some(u => !/^[a-z0-9-]+$/.test(u))) throw new Error('This pilot requires two unique user aliases.');
  for (const [key, min, max] of [['rounds', 1, 10], ['pauseMs', 1000, 30000], ['maxPageMs', 1000, 60000], ['maxActionMs', 5000, 120000]]) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error('Invalid bounded setting: ' + key);
  }
  if (!Array.isArray(c.scenarios) || c.scenarios.length === 0 || c.scenarios.some(s => !ALLOWED_SCENARIOS.has(s))) {
    throw new Error('Invalid scenarios list.');
  }
  if (c.headless != null && typeof c.headless !== 'boolean') throw new Error('headless must be a boolean when set.');
  return c;
}
export function validateScope(c, scope, facilities) {
  if (scope.organizationId !== c.organizationId || scope.facilityId !== c.facilityId) throw new Error('Active organization/facility does not match the demo scope.');
  if (!Array.isArray(facilities) || facilities.filter(f => f.id === c.facilityId && f.name === FACILITY).length !== 1) throw new Error('Server facility identity could not be confirmed.');
}
