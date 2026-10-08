import {
  CHARTING_SHEET,
  chartingMedGive,
  chartingMedGivePage,
  chartingResidentPicker,
  appShell,
} from '../selectors.mjs';
import { parseGiveTestId } from '../data.mjs';
import { startTimer, finishTimer } from '../timing.mjs';

export async function openChartingForResident(actor, config, resident) {
  await actor.verify();
  const url = `https://hubsteriacare.com${CHARTING_SHEET}`;
  await actor.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await actor.page.locator(appShell).first().waitFor({ state: 'visible', timeout: 30000 });
  await actor.verify();
  const picker = actor.page.locator(chartingResidentPicker);
  if (await picker.count()) {
    await picker.click();
    const name = `${resident.first_name} ${resident.last_name}`.trim();
    await actor.page.getByRole('option', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click({ timeout: 15000 });
  } else {
    await actor.page.goto(`https://hubsteriacare.com/app/residents/${resident.id}?tab=emar`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await actor.verify();
    const sheetLink = actor.page.getByRole('link', { name: /charting sheet/i });
    if (await sheetLink.count()) await sheetLink.first().click({ timeout: 15000 });
    else await actor.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await actor.page.waitForTimeout(config.pauseMs);
}

export async function listPendingGiveTargets(page) {
  const buttons = page.locator('[data-testid^="charting-sheet-med-give-"]');
  const count = await buttons.count();
  const targets = [];
  for (let i = 0; i < count; i++) {
    const testId = await buttons.nth(i).getAttribute('data-testid');
    const parsed = parseGiveTestId(testId);
    if (parsed) targets.push({ ...parsed, testId });
  }
  return targets;
}

async function completeGiveDialog(page, config) {
  await page.locator(chartingMedGivePage).waitFor({ state: 'visible', timeout: 30000 });
  const dialog = page.locator(chartingMedGivePage);
  const required = dialog.locator('input[required], textarea[required], select[required]');
  const reqCount = await required.count();
  for (let i = 0; i < reqCount; i++) {
    const el = required.nth(i);
    const tag = await el.evaluate(node => node.tagName.toLowerCase());
    if (tag === 'select') {
      await el.selectOption({ index: 1 });
    } else {
      const type = await el.getAttribute('type');
      await el.fill(type === 'number' ? '0' : 'Simulator demo — fictional note');
    }
  }
  const labels = [/confirm/i, /save/i, /record/i, /give/i, /complete/i];
  for (const pattern of labels) {
    const btn = dialog.getByRole('button', { name: pattern });
    if (await btn.count()) {
      await btn.first().click({ timeout: 15000 });
      break;
    }
  }
  await page.waitForTimeout(config.pauseMs);
}

export async function giveScheduledDose(actor, config, { resident, occurrenceKey, allowUncertain = false, skipOpen = false }) {
  const timer = startTimer();
  let responseMs = null;
  const responsePromise = actor.page.waitForResponse(
    r => r.url().includes('/rest/v1/medication_administrations') && ['POST', 'PATCH'].includes(r.request().method()),
    { timeout: config.maxActionMs },
  ).catch(() => null);
  if (!skipOpen) await openChartingForResident(actor, config, resident);
  const give = actor.page.locator(chartingMedGive(occurrenceKey));
  if (!(await give.count())) {
    throw new Error(`Pending dose control missing for occurrence ${occurrenceKey}. Demo may have been reseeded.`);
  }
  await give.first().click({ timeout: 20000 });
  await completeGiveDialog(actor.page, config);
  const response = await responsePromise;
  if (response) {
    const timing = response.request().timing();
    responseMs = timing?.responseEnd ?? null;
  } else if (!allowUncertain) {
    throw new Error('Medication write response was not observed; not retrying uncertain save.');
  }
  const timing = finishTimer(timer, { responseMs });
  return { timing, occurrenceKey };
}

export async function attemptConcurrentGive(actors, config, { resident, occurrenceKey }) {
  return Promise.all(actors.map(actor =>
    giveScheduledDose(actor, config, { resident, occurrenceKey, allowUncertain: true, skipOpen: true }),
  ));
}
