import { createServer, get, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, runShutdownStage } from '../../src/utils/shutdown.ts';
import { setLogSink } from '../../src/utils/logger.ts';

describe('bounded shutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLogSink(null);
  });

  function exitSpy() {
    return vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
  }

  it('runs once, drains streams before cleanup, and upgrades repeated fatal signals to exit 1', async () => {
    const exit = exitSpy();
    const closed = Promise.withResolvers<void>();
    const server = createServer();
    vi.spyOn(server, 'close').mockImplementation((callback) => {
      closed.promise.then(() => callback?.());
      return server;
    });
    const onStart = vi.fn();
    const cleanup = vi.fn();
    const closeStreams = vi.fn(() => closed.resolve());
    const shutdown = createShutdownHandler({
      getServer: () => server,
      onStart,
      closeStreams,
      cleanup: { fixture: cleanup },
    });
    const first = shutdown('SIGTERM');
    const result = first.catch((error) => error);
    expect(shutdown('uncaughtException')).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ message: 'exit:1' });
    expect(onStart).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(closeStreams).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds active requests and hung cleanup to ten seconds, not the hard thirty-second deadline', async () => {
    const exit = exitSpy();
    const server = createServer();
    vi.spyOn(server, 'close').mockReturnValue(server);
    const forceClose = vi.spyOn(server, 'closeAllConnections').mockImplementation(() => {});
    const healthy = vi.fn();
    const logs: Array<{ message: string; data: unknown }> = [];
    setLogSink((_level, _context, message, data) => logs.push({ message, data }));
    const shutdown = createShutdownHandler({
      getServer: () => server,
      onStart: () => {},
      closeStreams: () => {},
      cleanup: { stuck: () => new Promise(() => {}), healthy },
    });
    const result = shutdown('SIGTERM').catch((error) => error);
    await vi.advanceTimersByTimeAsync(4999);
    expect(forceClose).not.toHaveBeenCalled();
    expect(healthy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forceClose).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ message: 'exit:1' });
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: 'Shutdown stage failed',
        data: expect.objectContaining({ stage: 'stuck' }),
      })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up without a listener and exits zero for a successful normal stop', async () => {
    const exit = exitSpy();
    const cleanup = vi.fn();
    const shutdown = createShutdownHandler({
      getServer: () => null,
      onStart: () => {},
      closeStreams: () => {},
      cleanup: { fixture: cleanup },
    });
    await expect(shutdown('SIGINT')).rejects.toThrow('exit:0');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a failed cleanup and observes rejection even after its timeout', async () => {
    const work = Promise.withResolvers<void>();
    const result = runShutdownStage('fixture', 1000, () => work.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(false);
    work.reject(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('drains a real streaming HTTP connection when streams are explicitly ended', async () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  let endStream = () => {};
  const server: Server = createServer((_req, res) => {
    endStream = () => res.end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': ping\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected bound test port');
  const req = get({ host: '127.0.0.1', port: address.port, agent: false });
  try {
    const response = await new Promise<import('node:http').IncomingMessage>((resolve) =>
      req.once('response', resolve)
    );
    response.resume();
    const shutdown = createShutdownHandler({
      getServer: () => server,
      onStart: () => {},
      closeStreams: () => endStream(),
      cleanup: {},
    });
    await expect(shutdown('SIGTERM')).rejects.toThrow('exit:0');
    expect(server.listening).toBe(false);
    expect(exit).toHaveBeenCalledOnce();
  } finally {
    req.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    exit.mockRestore();
  }
});
