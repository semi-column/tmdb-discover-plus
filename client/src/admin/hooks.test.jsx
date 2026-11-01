import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAsync } from './hooks.js';

afterEach(() => vi.useRealTimers());

it('does not pile up polling queries while the previous query is still running', async () => {
  vi.useFakeTimers();
  let resolve;
  const loader = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result, unmount } = renderHook(() => useAsync(loader, [], { pollMs: 1000 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(loader).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve({ ok: true });
  });
  expect(result.current.data).toEqual({ ok: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(loader).toHaveBeenCalledTimes(2);
  unmount();
});
