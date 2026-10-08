import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { attachFacilityListener, assertDemoScope } from './scope.mjs';

export async function createActor(browser, config, alias, { stored = true } = {}) {
  const context = await browser.newContext(stored ? { storageState: '.auth/' + alias + '.json' } : {});
  const page = await context.newPage();
  const facilityListener = attachFacilityListener(page, config);
  const supabaseAuth = { apikey: null, host: null, captured: false };
  page.on('request', request => {
    const url = request.url();
    if (!url.includes('.supabase.co/rest/v1/')) return;
    const apikey = request.headers()['apikey'];
    if (apikey) {
      supabaseAuth.apikey = apikey;
      supabaseAuth.host = new URL(url).origin;
      supabaseAuth.captured = true;
    }
  });
  return {
    alias,
    context,
    page,
    facilityListener,
    supabaseAuth,
    async verify() {
      return assertDemoScope(page, config, facilityListener);
    },
  };
}

export async function loginActor(browser, config, alias) {
  await mkdir('.auth', { recursive: true, mode: 0o700 });
  const actor = await createActor(browser, config, alias, { stored: false });
  await actor.page.goto('https://hubsteriacare.com/auth');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await terminal.question('Sign in manually, complete MFA, select HubsteriaCare demo facility, then press Enter here. ');
  } finally {
    terminal.close();
  }
  await actor.page.reload();
  await actor.page.waitForTimeout(3000);
  await actor.verify();
  await writeFile('.auth/' + alias + '.json', JSON.stringify(await actor.context.storageState()), { mode: 0o600 });
  return actor;
}

export async function readStaffIdentity(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    if (!key) return null;
    try {
      const session = JSON.parse(localStorage.getItem(key));
      return { userId: session?.user?.id ?? null, email: session?.user?.email ?? null };
    } catch {
      return null;
    }
  });
}
