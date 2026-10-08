import { validateScope } from './policy.mjs';

export function attachFacilityListener(page, config) {
  let facilityRows = null;
  const responses = new Set();
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname !== '/rest/v1/facilities') return;
    if (url.searchParams.get('organization_id') !== 'eq.' + config.organizationId) return;
    const task = response.json().then(rows => { if (response.ok()) facilityRows = rows; }).catch(() => {});
    responses.add(task);
    task.finally(() => responses.delete(task));
  });
  return {
    async drain() {
      await Promise.all([...responses]);
      return facilityRows;
    },
    peek() {
      return facilityRows;
    },
  };
}

export async function readActiveScope(page) {
  return page.evaluate(() => {
    const organizationId = localStorage.getItem('hc.currentOrgId');
    return { organizationId, facilityId: localStorage.getItem('hc.activeFacility:' + organizationId) };
  });
}

export async function assertDemoScope(page, config, facilityListener) {
  await facilityListener.drain();
  const scope = await readActiveScope(page);
  const facilities = facilityListener.peek();
  validateScope(config, scope, facilities);
  const url = new URL(page.url());
  if (url.origin !== new URL(config.target).origin || !url.pathname.startsWith('/app')) {
    throw new Error('Not in the authenticated app shell.');
  }
  return scope;
}
