import { performance } from 'node:perf_hooks';
import os from 'node:os';

export function startTimer() {
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  const load = os.loadavg();
  return { wallStart, cpuStart, load };
}

export function finishTimer(handle, { responseMs = null, ttfbMs = null } = {}) {
  const wallMs = Math.round(performance.now() - handle.wallStart);
  const cpu = process.cpuUsage(handle.cpuStart);
  const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
  const load = os.loadavg();
  const hostStress = handle.load[0] > 4 || load[0] > 6;
  const networkSlow = responseMs != null && responseMs > 8000;
  const likelyApp = networkSlow && !hostStress;
  const likelyHost = hostStress && (responseMs == null || responseMs < 4000);
  return {
    wallMs,
    cpuMs,
    responseMs,
    ttfbMs,
    loadAvg: { atStart: handle.load[0], atEnd: load[0] },
    bottleneckHint: likelyApp ? 'application' : likelyHost ? 'host' : networkSlow ? 'mixed' : 'none',
  };
}
