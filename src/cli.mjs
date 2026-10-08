import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { performance } from 'node:perf_hooks';
import { validateConfig, validateScope, TARGET } from './policy.mjs';

const command = process.argv[2];
const config = validateConfig(JSON.parse(await readFile('config.local.json', 'utf8')));
const paths = ['/app', '/app/residents', '/app/med-tasks'];
if (command === 'plan') {
  console.log(JSON.stringify({ target: TARGET, facility: config.facilityName, users: config.users, rounds: config.rounds, paths, mode: 'read-only browser baseline', medicationWrites: false }, null, 2));
} else if (command === 'login' || command === 'run') {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: command !== 'login' });
  async function prepare(alias, stored) {
    const context = await browser.newContext(stored ? { storageState: '.auth/' + alias + '.json' } : {});
    const page = await context.newPage();
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
    async function verify() {
      await Promise.all([...responses]);
      const scope = await page.evaluate(() => {
        const organizationId = localStorage.getItem('hc.currentOrgId');
        return { organizationId, facilityId: localStorage.getItem('hc.activeFacility:' + organizationId) };
      });
      validateScope(config, scope, facilityRows);
      if (new URL(page.url()).origin !== new URL(TARGET).origin || !new URL(page.url()).pathname.startsWith('/app')) throw new Error('Not in the authenticated app.');
    }
    return { alias, context, page, verify };
  }
  try {
    if (command === 'login') {
      const alias = process.argv[3];
      if (!config.users.includes(alias)) throw new Error('Use: npm run login -- caregiver-1 (or caregiver-2).');
      await mkdir('.auth', { recursive: true, mode: 0o700 });
      const actor = await prepare(alias, false);
      await actor.page.goto('https://hubsteriacare.com/auth');
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question('Sign in manually, complete MFA, select HubsteriaCare demo facility, then press Enter here. '); } finally { terminal.close(); }
      // Reload so identity verification uses a fresh server facility response.
      await actor.page.reload();
      await actor.page.waitForTimeout(3000);
      await actor.verify();
      await writeFile('.auth/' + alias + '.json', JSON.stringify(await actor.context.storageState()), { mode: 0o600 });
      console.log('Verified demo session saved locally for ' + alias);
    } else {
      const actors = [];
      const results = [];
      const reportDir = 'reports/' + new Date().toISOString().replaceAll(':', '-');
      await mkdir(reportDir, { recursive: true, mode: 0o700 });
      // Preflight BOTH actors before starting concurrent work.
      for (const alias of config.users) {
        const actor = await prepare(alias, true);
        actors.push(actor);
        await actor.page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await actor.page.waitForTimeout(3000);
        await actor.verify();
      }
      const identities = await Promise.all(actors.map(actor => actor.page.evaluate(() => {
        const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
        if (!key) return null;
        try { return JSON.parse(localStorage.getItem(key))?.user?.id ?? null; } catch { return null; }
      })));
      if (identities.some(id => !id) || new Set(identities).size !== actors.length) throw new Error('Two distinct authenticated staff accounts are required.');
      let stop = false;
      for (let round = 1; round <= config.rounds && !stop; round++) {
        for (const path of paths) {
          if (stop) break;
          await Promise.all(actors.map(async actor => {
            const started = performance.now();
            try {
              await actor.verify();
              await actor.page.goto('https://hubsteriacare.com' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await actor.page.locator('[data-sidebar="sidebar"], [data-mobile-bottom-nav]').first().waitFor({ state: 'visible', timeout: 30000 });
              await actor.verify();
              if (new URL(actor.page.url()).pathname !== path) throw new Error('Unexpected redirect.');
              const body = await actor.page.locator('body').innerText();
              if (/Application error|Something went wrong/i.test(body)) throw new Error('App error displayed.');
              const elapsedMs = Math.round(performance.now() - started);
              results.push({ actor: actor.alias, round, path, elapsedMs, status: elapsedMs <= config.maxPageMs ? 'pass' : 'slow' });
            } catch {
              stop = true;
              // Do not collect page content on a scope failure: it might belong to another facility.
              results.push({ actor: actor.alias, round, path, status: 'fail', reason: 'Navigation, authentication, scope, or app check failed; run stopped.' });
            }
          }));
          if (!stop) await new Promise(resolve => setTimeout(resolve, config.pauseMs));
        }
      }
      const report = { mode: 'read-only baseline', medicationWrites: 0, facility: config.facilityName, results, passed: results.length > 0 && results.every(r => r.status === 'pass') };
      await writeFile(reportDir + '/results.json', JSON.stringify(report, null, 2), { mode: 0o600 });
      const rows = results.map(r => '<tr><td>' + r.actor + '</td><td>' + r.round + '</td><td>' + r.path + '</td><td>' + r.status + '</td><td>' + (r.elapsedMs ?? '') + '</td></tr>').join('');
      await writeFile(reportDir + '/index.html', '<!doctype html><meta charset="utf-8"><title>Hubsteria Simulator</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}</style><h1>Hubsteria Simulator</h1><p>Demo facility · two concurrent staff sessions · read-only baseline</p><p>Medication administration and data persistence are not tested in this run.</p><table><tr><th>User</th><th>Round</th><th>Page</th><th>Result</th><th>Navigation + shell + checks (ms)</th></tr>' + rows + '</table>', { mode: 0o600 });
      console.log('Report: ' + reportDir + '/index.html');
      if (!report.passed) process.exitCode = 1;
    }
  } finally { await browser.close(); }
} else {
  throw new Error('Commands: plan, login, run');
}
