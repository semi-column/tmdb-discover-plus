import type { Server } from 'node:http';
import { TIMEOUTS } from '../constants.ts';
import { createLogger } from './logger.ts';

const log = createLogger('shutdown');
const DRAIN_MS = 5_000;
const CLEANUP_MS = 5_000;

export async function runShutdownStage(
  stage: string,
  timeoutMs: number,
  work: () => void | Promise<unknown>
): Promise<boolean> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Shutdown stage timed out')), timeoutMs);
      }),
    ]);
    log.debug('Shutdown stage completed', { stage, durationMs: Date.now() - started });
    return true;
  } catch (error) {
    log.warn('Shutdown stage failed', { stage, durationMs: Date.now() - started, error });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createShutdownHandler(options: {
  getServer: () => Server | null;
  onStart: () => void;
  closeStreams: () => void;
  cleanup: Record<string, () => void | Promise<unknown>>;
}): (signal: string) => Promise<void> {
  let pending: Promise<void> | undefined;
  let exitCode = 0;
  return (signal) => {
    if (signal === 'uncaughtException') exitCode = 1;
    if (pending) {
      log.debug('Shutdown already in progress', { signal });
      return pending;
    }
    log.info(`Received ${signal}, starting graceful shutdown...`);
    pending = Promise.resolve().then(async () => {
      const hardTimeout = setTimeout(() => {
        log.warn('Shutdown timeout reached, forcing exit');
        process.exit(1);
      }, TIMEOUTS.SHUTDOWN_MS);
      try {
        options.onStart();
        const server = options.getServer();
        // Start closing the listener before ending streams; new work must not enter.
        const closed = server
          ? new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve()))
            )
          : Promise.resolve();
        const draining = runShutdownStage('http-drain', DRAIN_MS, () => closed);
        const streamsClosed = await runShutdownStage(
          'live-streams',
          CLEANUP_MS,
          options.closeStreams
        );
        const drained = await draining;
        if (!drained) {
          server?.closeAllConnections();
          log.warn('HTTP drain deadline reached; active connections closed');
        }
        const results = await Promise.all(
          Object.entries(options.cleanup).map(([stage, work]) =>
            runShutdownStage(stage, CLEANUP_MS, work)
          )
        );
        if (!streamsClosed || !drained || results.some((ok) => !ok)) exitCode = 1;
        log.info('Shutdown completed', { exitCode });
      } catch (error) {
        exitCode = 1;
        log.error('Shutdown failed', { error });
      } finally {
        clearTimeout(hardTimeout);
      }
      process.exit(exitCode);
    });
    return pending;
  };
}
