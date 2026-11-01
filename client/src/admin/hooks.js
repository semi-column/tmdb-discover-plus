import { useEffect, useState } from 'react';

/** Loads data via `loader` whenever `deps` change; optional polling. Stale responses are dropped. */
export function useAsync(loader, deps, { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const run = async (silent) => {
      if (inFlight) return;
      inFlight = true;
      if (!silent) setState((s) => ({ ...s, loading: true }));
      try {
        const data = await loader();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, error, loading: false }));
      } finally {
        inFlight = false;
      }
    };
    run(false);
    const timer = pollMs
      ? setInterval(() => document.visibilityState === 'visible' && run(true), pollMs)
      : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useHashRoute() {
  const read = () => {
    const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
    return { page: path || 'overview', params: Object.fromEntries(new URLSearchParams(query)) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(page, params = {}) {
  const currentQuery = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const nextParams = { ...params };
  if (nextParams.range && nextParams.range !== 'custom') {
    delete nextParams.from;
    delete nextParams.to;
  } else if (currentQuery.get('range') === 'custom') {
    nextParams.range ??= 'custom';
    nextParams.from ??= currentQuery.get('from');
    nextParams.to ??= currentQuery.get('to');
  }
  const query = new URLSearchParams(
    Object.entries(nextParams).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  window.location.hash = `/${page}${query ? `?${query}` : ''}`;
}
