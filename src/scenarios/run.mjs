import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fetchResidentsForFacility, queryAdministrations } from '../data.mjs';
import { recordAction, writeReports } from '../report.mjs';
import { shouldStop } from '../stop.mjs';
import { listPendingGiveTargets, giveScheduledDose, attemptConcurrentGive, openChartingForResident } from '../workflows/charting-med.mjs';
import { chartAdl, chartVitals, chartQuickNote } from '../workflows/clinical-docs.mjs';
import { appShell } from '../selectors.mjs';
import { readStaffIdentity } from '../session.mjs';

const NAV_PATHS = ['/app', '/app/residents', '/app/med-tasks'];

async function captureFailureEvidence(actor, reportDir, label) {
  await actor.verify();
  const path = `${reportDir}/evidence-${actor.alias}-${label}.png`;
  await actor.page.screenshot({ path, fullPage: true });
  return path;
}

async function verifyAdministration(actor, config, identity, assignment) {
  await actor.page.reload({ waitUntil: 'domcontentloaded' });
  await actor.verify();
  const result = await queryAdministrations(actor, config, {
    orderId: assignment.orderId,
    scheduledFor: assignment.scheduledFor,
  });
  if (!result.ok) throw new Error(`Could not verify administration (${result.status}).`);
  const rows = result.rows ?? [];
  const given = rows.filter(r => r.status === 'given' || r.status === 'delayed');
  if (given.length !== 1) {
    throw new Error(`Expected exactly one saved administration, found ${given.length}.`);
  }
  const row = given[0];
  if (row.resident_id !== assignment.residentId) throw new Error('Administration resident mismatch.');
  if (row.order_id !== assignment.orderId) throw new Error('Administration order mismatch.');
  const performerOk = row.performed_by === identity.userId ||
    (row.performed_by_name && identity.email && row.performed_by_name.toLowerCase().includes(identity.email.split('@')[0].toLowerCase()));
  if (!performerOk) throw new Error('Administration caregiver mismatch.');
  return row;
}

export async function runSimulation({ browser, config, actors }) {
  const actions = [];
  const reportDir = 'reports/' + new Date().toISOString().replaceAll(':', '-');
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  let interrupted = false;
  let interruptedReason = '';
  let verifiedSuccesses = 0;
  let failures = 0;

  const identities = await Promise.all(actors.map(a => readStaffIdentity(a.page)));
  if (identities.some(id => !id?.userId) || new Set(identities.map(i => i.userId)).size !== actors.length) {
    throw new Error('Two distinct authenticated staff accounts are required.');
  }

  const residents = await fetchResidentsForFacility(actors[0], config);
  const assignments = [];

  if (config.scenarios.includes('navigation')) {
    for (let round = 1; round <= config.rounds && !shouldStop(); round++) {
      for (const path of NAV_PATHS) {
        if (shouldStop()) break;
        await Promise.all(actors.map(async actor => {
          const started = performance.now();
          try {
            await actor.verify();
            await actor.page.goto('https://hubsteriacare.com' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await actor.page.locator(appShell).first().waitFor({ state: 'visible', timeout: 30000 });
            await actor.verify();
            const elapsedMs = Math.round(performance.now() - started);
            const status = elapsedMs <= config.maxPageMs ? 'pass' : 'slow';
            recordAction(actions, { actor: actor.alias, scenario: 'navigation', step: path, status, detail: `${elapsedMs}ms`, timing: { wallMs: elapsedMs, bottleneckHint: 'none' } });
            if (status === 'slow') failures += 1;
            else verifiedSuccesses += 1;
          } catch (err) {
            failures += 1;
            recordAction(actions, { actor: actor.alias, scenario: 'navigation', step: path, status: 'fail', detail: String(err.message ?? err) });
          }
        }));
        if (!shouldStop()) await new Promise(r => setTimeout(r, config.pauseMs));
      }
    }
  }

  if (config.scenarios.includes('medication') && !shouldStop()) {
    const plans = [];
    for (let i = 0; i < actors.length; i++) {
      const resident = residents[i % residents.length];
      await openChartingForResident(actors[i], config, resident);
      const targets = await listPendingGiveTargets(actors[i].page);
      if (!targets.length) {
        interrupted = true;
        interruptedReason = 'No pending scheduled doses visible in Charting Sheet (demo reseed or missing data).';
        break;
      }
      const pick = targets.find(t => !plans.some(p => p.occurrenceKey === t.occurrenceKey)) ?? targets[0];
      plans.push({ actor: actors[i], resident, ...pick, residentId: resident.id });
    }
    if (!interrupted && plans.length === actors.length) {
      const results = await Promise.all(plans.map(plan =>
        giveScheduledDose(plan.actor, config, { resident: plan.resident, occurrenceKey: plan.occurrenceKey }),
      ));
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        try {
          const row = await verifyAdministration(plan.actor, config, identities[i], plan);
          verifiedSuccesses += 1;
          assignments.push({ ...plan, administrationId: row.id });
          recordAction(actions, {
            actor: plan.actor.alias,
            scenario: 'medication',
            step: 'give+verify',
            status: 'pass',
            detail: `${plan.orderId} @ ${plan.scheduledFor}`,
            timing: results[i].timing,
          });
        } catch (err) {
          failures += 1;
          const shot = await captureFailureEvidence(plan.actor, reportDir, 'med-fail').catch(() => null);
          recordAction(actions, {
            actor: plan.actor.alias,
            scenario: 'medication',
            step: 'verify',
            status: 'fail',
            detail: `${err.message ?? err}${shot ? ` · ${shot}` : ''}`,
          });
        }
      }
    }
  }

  if (config.scenarios.includes('collision') && !shouldStop() && !interrupted) {
    const resident = residents[0];
    await openChartingForResident(actors[0], config, resident);
    const targets = await listPendingGiveTargets(actors[0].page);
    const shared = targets.find(t => !assignments.some(a => a.occurrenceKey === t.occurrenceKey));
    if (!shared) {
      recordAction(actions, { actor: 'both', scenario: 'collision', step: 'plan', status: 'skip', detail: 'No unused pending dose for collision test.' });
    } else {
      await Promise.all(actors.map(a => openChartingForResident(a, config, resident)));
      try {
        await attemptConcurrentGive(actors, config, { resident, occurrenceKey: shared.occurrenceKey });
      } catch {
        // expected: one may fail with concurrency guard
      }
      const checks = await Promise.all(actors.map((actor, i) =>
        queryAdministrations(actor, config, { orderId: shared.orderId, scheduledFor: shared.scheduledFor }),
      ));
      const union = new Set();
      for (const c of checks) {
        for (const row of c.rows ?? []) {
          if (row.status === 'given' || row.status === 'delayed') union.add(row.id);
        }
      }
      const status = union.size === 1 ? 'pass' : 'fail';
      if (status === 'pass') verifiedSuccesses += 1;
      else failures += 1;
      recordAction(actions, {
        actor: 'both',
        scenario: 'collision',
        step: 'same-dose',
        status,
        detail: `administration rows with given/delayed: ${union.size}`,
      });
    }
  }

  const docScenarios = [
    ['adl', chartAdl],
    ['vitals', chartVitals],
    ['notes', chartQuickNote],
  ];
  for (const [name, fn] of docScenarios) {
    if (!config.scenarios.includes(name) || shouldStop() || interrupted) continue;
    await Promise.all(actors.map(async (actor, i) => {
      const resident = residents[(i + 1) % residents.length];
      try {
        const { timing } = await fn(actor, config, resident);
        verifiedSuccesses += 1;
        recordAction(actions, { actor: actor.alias, scenario: name, step: 'chart', status: 'pass', timing });
      } catch (err) {
        failures += 1;
        const shot = await captureFailureEvidence(actor, reportDir, name).catch(() => null);
        recordAction(actions, {
          actor: actor.alias,
          scenario: name,
          step: 'chart',
          status: 'fail',
          detail: `${err.message ?? err}${shot ? ` · ${shot}` : ''}`,
        });
      }
    }));
    await new Promise(r => setTimeout(r, config.pauseMs));
  }

  const report = {
    mode: 'concurrent clinical pilot',
    facility: config.facilityName,
    actors: actors.map(a => a.alias),
    scenarios: config.scenarios,
    actions,
    verifiedSuccesses,
    failures,
    interrupted,
    interruptedReason: interrupted ? interruptedReason : null,
    passed: !interrupted && failures === 0 && verifiedSuccesses > 0,
  };
  await writeReports(reportDir, report);
  return { reportDir, report };
}
