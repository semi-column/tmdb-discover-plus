const BASE = '/api/admin';

export class AdminApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Admin-Request': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('admin:unauthorized'));
    throw new AdminApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const adminApi = {
  session: () => request('/session'),
  login: (body) => request('/login', { method: 'POST', body }),
  logout: () => request('/logout', { method: 'POST' }),
  meta: () => request('/meta'),
  overview: (params) => request('/overview', { params }),
  routes: (params) => request('/routes', { params }),
  requests: (params) => request('/requests', { params }),
  facets: (params) => request('/requests/facets', { params }),
  trace: (requestId) => request(`/requests/${encodeURIComponent(requestId)}`),
  errors: (params) => request('/errors', { params }),
  errorGroup: (fp) => request(`/errors/${encodeURIComponent(fp)}`),
  setErrorStatus: (fp, status) =>
    request(`/errors/${encodeURIComponent(fp)}`, { method: 'PATCH', body: { status } }),
  upstreams: (params) => request('/upstreams', { params }),
  usage: (params) => request('/usage', { params }),
  system: (params) => request('/system', { params }),
  diagnostics: () => request('/diagnostics'),
  security: () => request('/security'),
  generateTotp: () => request('/security/totp', { method: 'POST' }),
};

/** Export uses a normal download; the custom header can't be set on a link, so fetch + blob. */
export async function downloadExport(params) {
  const url = new URL(`${BASE}/export`, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Admin-Request': '1' } });
  if (!res.ok) throw new AdminApiError(res.status, `Export failed (${res.status})`);
  const blob = await res.blob();
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'export';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** EventSource can't send custom headers, so the live tail is read from a fetch stream. */
export function openLiveStream({ onBacklog, onRequests, onError }) {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/live`, {
        credentials: 'same-origin',
        headers: { 'X-Admin-Request': '1', Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body)
        throw new AdminApiError(res.status, `Live stream failed (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!event || !data) continue;
          const parsed = JSON.parse(data);
          if (event === 'backlog') onBacklog(parsed);
          else if (event === 'requests') onRequests(parsed);
        }
      }
      if (!controller.signal.aborted) onError(new Error('Live stream ended'));
    } catch (err) {
      if (!controller.signal.aborted) onError(err);
    }
  })();
  return () => controller.abort();
}
