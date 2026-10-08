import { writeFile } from 'node:fs/promises';

function esc(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function writeReports(reportDir, report) {
  await writeFile(reportDir + '/results.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  const rows = (report.actions ?? []).map(a => {
    const timing = a.timing ? `${a.timing.wallMs}ms (${a.timing.bottleneckHint})` : '';
    return `<tr><td>${esc(a.actor)}</td><td>${esc(a.scenario)}</td><td>${esc(a.step)}</td><td>${esc(a.status)}</td><td>${timing}</td><td>${esc(a.detail ?? '')}</td></tr>`;
  }).join('');
  const interrupted = report.interrupted ? `<p><strong>Run interrupted:</strong> ${esc(report.interruptedReason)}</p>` : '';
  const html = `<!doctype html><meta charset="utf-8"><title>Hubsteria Simulator</title>
<style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left} .fail{color:#b91c1c} .pass{color:#15803d}</style>
<h1>Hubsteria Simulator</h1>
<p>${esc(report.facility)} · ${report.actors?.length ?? 0} concurrent staff sessions · ${esc(report.mode)}</p>
${interrupted}
<p>Verified successes: ${report.verifiedSuccesses ?? 0} · Failures: ${report.failures ?? 0}</p>
<table><tr><th>Actor</th><th>Scenario</th><th>Step</th><th>Result</th><th>Timing</th><th>Detail</th></tr>${rows}</table>`;
  await writeFile(reportDir + '/index.html', html, { mode: 0o600 });
}

export function recordAction(actions, entry) {
  actions.push({ ...entry, at: new Date().toISOString() });
}
