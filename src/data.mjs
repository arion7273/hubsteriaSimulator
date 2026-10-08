const residentSelect =
  'id, first_name, last_name, facility_id, organization_id, status, lifecycle_status';

export async function captureRestJson(page, predicate) {
  const bucket = [];
  const handler = async response => {
    const url = new URL(response.url());
    if (!url.hostname.includes('.supabase.co') || !url.pathname.startsWith('/rest/v1/')) return;
    if (!predicate(url)) return;
    try {
      if (response.ok()) bucket.push({ path: url.pathname, query: url.search, body: await response.json() });
    } catch {
      // ignore parse errors
    }
  };
  page.on('response', handler);
  return {
    rows() {
      return bucket;
    },
    detach() {
      page.off('response', handler);
    },
  };
}

export async function fetchResidentsForFacility(actor, config) {
  const identity = await actor.page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    const session = key ? JSON.parse(localStorage.getItem(key)) : null;
    return { token: session?.access_token ?? null };
  });
  if (!identity.token || !actor.supabaseAuth.apikey) {
    throw new Error('Cannot query residents without an authenticated browser session.');
  }
  const base = actor.supabaseAuth.host ?? new URL(actor.page.url()).origin;
  const url = `${base}/rest/v1/residents?select=${encodeURIComponent(residentSelect)}` +
    `&organization_id=eq.${config.organizationId}` +
    `&facility_id=eq.${config.facilityId}` +
    '&order=last_name.asc&limit=50';
  const result = await actor.page.evaluate(async ({ url, token, apikey }) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, apikey, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status, rows: [] };
    return { ok: true, status: res.status, rows: await res.json() };
  }, { url, token: identity.token, apikey: actor.supabaseAuth.apikey });
  if (!result.ok) throw new Error(`Resident query failed (${result.status}). Demo data may be reseeding.`);
  const active = (result.rows ?? []).filter(r => r && r.facility_id === config.facilityId);
  if (active.length < 2) {
    throw new Error('Fewer than two demo residents in the authorized facility; run may be interrupted.');
  }
  return active;
}

export async function queryAdministrations(actor, config, { orderId, scheduledFor }) {
  const identity = await actor.page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    const session = key ? JSON.parse(localStorage.getItem(key)) : null;
    return { token: session?.access_token ?? null };
  });
  if (!identity.token || !actor.supabaseAuth.apikey) throw new Error('Missing session for administration verification.');
  const base = actor.supabaseAuth.host;
  if (!base) throw new Error('Supabase host not observed yet; open the app once before verifying administrations.');
  const filter = `organization_id=eq.${config.organizationId}&order_id=eq.${orderId}&scheduled_for=eq.${encodeURIComponent(scheduledFor)}`;
  const url = `${base}/rest/v1/medication_administrations?select=id,resident_id,order_id,scheduled_for,status,performed_by_name,administered_at,performed_by&${filter}`;
  return actor.page.evaluate(async ({ url, token, apikey }) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status, rows: [] };
    return { ok: true, rows: await res.json() };
  }, { url, token: identity.token, apikey: actor.supabaseAuth.apikey });
}

const UUID_LEN = 36;

export function parseGiveTestId(testId) {
  const prefix = 'charting-sheet-med-give-';
  if (!testId?.startsWith(prefix)) return null;
  const occurrenceKey = testId.slice(prefix.length);
  if (occurrenceKey.length <= UUID_LEN + 1) return null;
  const orderId = occurrenceKey.slice(0, UUID_LEN);
  const scheduledFor = occurrenceKey.slice(UUID_LEN + 1);
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !scheduledFor) return null;
  return { orderId, scheduledFor, occurrenceKey };
}
