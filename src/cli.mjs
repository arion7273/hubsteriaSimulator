import { readFile } from 'node:fs/promises';
import { validateConfig, TARGET } from './policy.mjs';
import { createActor, loginActor } from './session.mjs';
import { installStopHandlers, shouldStop } from './stop.mjs';
import { runSimulation } from './scenarios/run.mjs';

const command = process.argv[2];
const config = validateConfig(JSON.parse(await readFile('config.local.json', 'utf8')));

if (command === 'plan') {
  console.log(JSON.stringify({
    target: TARGET,
    facility: config.facilityName,
    users: config.users,
    rounds: config.rounds,
    scenarios: config.scenarios,
    pauseMs: config.pauseMs,
    concurrency: config.users.length,
    mode: 'concurrent Charting Sheet + clinical docs (demo facility only)',
  }, null, 2));
} else if (command === 'login') {
  const alias = process.argv[3];
  if (!config.users.includes(alias)) throw new Error('Use: npm run login -- caregiver-1 (or caregiver-2).');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  try {
    await loginActor(browser, config, alias);
    console.log('Verified demo session saved locally for ' + alias);
  } finally {
    await browser.close();
  }
} else if (command === 'run') {
  installStopHandlers(() => console.log('\nStop requested — finishing current step…'));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: config.headless !== false });
  const actors = [];
  try {
    for (const alias of config.users) {
      const actor = await createActor(browser, config, alias, { stored: true });
      actors.push(actor);
      await actor.page.goto(config.target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await actor.page.waitForTimeout(2000);
      await actor.verify();
      if (shouldStop()) break;
    }
    const { reportDir, report } = await runSimulation({ browser, config, actors });
    console.log('Report: ' + reportDir + '/index.html');
    if (!report.passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
} else {
  throw new Error('Commands: plan, login, run');
}
