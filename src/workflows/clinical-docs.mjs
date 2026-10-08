import { appShell, chartingQuickNotePage } from '../selectors.mjs';
import { startTimer, finishTimer } from '../timing.mjs';

const DEMO = {
  adlNote: 'Simulator ADL — fictional demo entry only.',
  vitals: { bp_systolic: '120', bp_diastolic: '78', pulse: '72' },
  note: 'Simulator progress note — fictional demo text for concurrency test.',
};

async function openResidentChart(actor, config, residentId, segment, params = {}) {
  await actor.verify();
  const qs = new URLSearchParams(params).toString();
  const path = `/app/residents/${residentId}/chart/${segment}${qs ? `?${qs}` : ''}`;
  await actor.page.goto('https://hubsteriacare.com' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await actor.page.locator(appShell).first().waitFor({ state: 'visible', timeout: 30000 });
  await actor.verify();
  await actor.page.waitForTimeout(config.pauseMs);
}

export async function chartAdl(actor, config, resident) {
  const timer = startTimer();
  await openResidentChart(actor, config, resident.id, 'adls', { adl: 'toileting', return: 'adls' });
  const save = actor.page.getByRole('button', { name: /save|record|complete|toileted/i });
  if (await save.count()) await save.first().click({ timeout: 15000 });
  const text = actor.page.locator('textarea').first();
  if (await text.count()) await text.fill(DEMO.adlNote);
  return { timing: finishTimer(timer) };
}

export async function chartVitals(actor, config, resident) {
  const timer = startTimer();
  await openResidentChart(actor, config, resident.id, 'vitals', { open: '1', return: 'vitals' });
  for (const [label, value] of Object.entries(DEMO.vitals)) {
    const field = actor.page.getByLabel(new RegExp(label.replace('_', ' '), 'i'));
    if (await field.count()) await field.first().fill(value);
  }
  const save = actor.page.getByRole('button', { name: /save|record/i });
  if (await save.count()) await save.first().click({ timeout: 15000 });
  return { timing: finishTimer(timer) };
}

export async function chartQuickNote(actor, config, resident) {
  const timer = startTimer();
  await actor.page.goto(`https://hubsteriacare.com/app/charting-sheet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await actor.verify();
  const noteEntry = actor.page.locator('[data-testid="charting-sheet-autochart-entry"], [data-testid="charting-sheet-quick-note-page"]');
  if (await noteEntry.count()) await noteEntry.first().click({ timeout: 10000 });
  await actor.page.locator(chartingQuickNotePage).waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const area = actor.page.locator('textarea').first();
  if (await area.count()) await area.fill(DEMO.note);
  const save = actor.page.getByRole('button', { name: /save|post|add note/i });
  if (await save.count()) await save.first().click({ timeout: 15000 });
  return { timing: finishTimer(timer) };
}
