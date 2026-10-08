import { watch } from 'node:fs';

let stopRequested = false;

export function requestStop(reason = 'stop signal') {
  stopRequested = true;
  return reason;
}

export function shouldStop() {
  return stopRequested;
}

export function installStopHandlers(onStop) {
  const handler = () => {
    requestStop('SIGINT');
    onStop?.('SIGINT');
  };
  process.on('SIGINT', handler);
  try {
    watch('.simulator-stop', () => {
      requestStop('.simulator-stop file');
      onStop?.('.simulator-stop');
    });
  } catch {
    // optional control file
  }
}
