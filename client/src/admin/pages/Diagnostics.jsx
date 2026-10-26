import { adminApi } from '../api.js';
import { useAsync } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel } from '../components/ui.jsx';

function verdicts(d) {
  const out = [];
  const h = d.headers;
  const cfSeen = !!(h['cf-ray'] || h['cf-connecting-ip']);

  if (d.trustCloudflareHeaders) {
    if (cfSeen)
      out.push(['good', 'Cloudflare headers reach the app (TRUST_CLOUDFLARE_HEADERS=true).']);
    else
      out.push([
        'bad',
        'TRUST_CLOUDFLARE_HEADERS is on but this request carries no Cloudflare headers. Unless Cloudflare is really in front, turn it off: otherwise anyone can fake their IP and country.',
      ]);
    if (h['cf-ipcountry'])
      out.push(['good', `Country data available (CF-IPCountry = ${h['cf-ipcountry']}).`]);
    else if (cfSeen)
      out.push([
        'warn',
        'No CF-IPCountry: enable IP Geolocation in Cloudflare to get country breakdowns.',
      ]);
  } else if (cfSeen) {
    out.push([
      'warn',
      'Cloudflare headers are present but not trusted. If Cloudflare is in front of this app, set TRUST_CLOUDFLARE_HEADERS=true to get real visitor IPs, countries and edge locations.',
    ]);
  } else {
    out.push([
      'good',
      'No Cloudflare in front: visitor IP comes from Express (req.ip); country/edge views are hidden.',
    ]);
  }

  const xff = (h['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!xff.length && !h['x-real-ip']) {
    out.push([
      'good',
      'No proxy forwarding headers: the app is reached directly, so req.ip is the visitor IP.',
    ]);
  } else if (d.resolved.clientIpUsed === xff[0]) {
    out.push([
      'good',
      `Visitor IP resolves to ${xff[0]} (first X-Forwarded-For entry): TRUST_PROXY looks right.`,
    ]);
  } else {
    out.push([
      'warn',
      `The app uses ${d.resolved.clientIpUsed || '(none)'} as the visitor IP, but X-Forwarded-For starts with ${xff[0] ?? '(none)'}. The app's rate limiters key on req.ip, so with TRUST_PROXY=${d.trustProxySetting} they may be limiting a proxy address instead of each visitor.`,
    ]);
  }

  if (!d.resolved.secure)
    out.push([
      'warn',
      'Request not seen as HTTPS: the admin cookie is sent without the Secure flag. Serve the admin over HTTPS.',
    ]);
  return out;
}

export function Diagnostics() {
  const { data, error, loading } = useAsync(() => adminApi.diagnostics(), []);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  const xff = (data.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="adm-stack">
      <Panel title="Proxy diagnosis (this request)">
        <ul className="adm-list">
          {verdicts(data).map(([tone, text], i) => (
            <li key={i}>
              <Badge tone={tone}>{tone === 'good' ? 'OK' : tone === 'bad' ? 'Fix' : 'Check'}</Badge>{' '}
              {text}
            </li>
          ))}
        </ul>
        {xff.length > 0 && (
          <p className="adm-muted">
            X-Forwarded-For: <span className="mono">{xff.join(' → ')}</span> (socket peer{' '}
            <span className="mono">{data.socketRemoteAddress}</span>). TRUST_PROXY={xff.length}{' '}
            would make req.ip the first address (<span className="mono">{xff[0]}</span>). Nothing is
            changed automatically.
          </p>
        )}
      </Panel>
      <div className="adm-grid-2">
        <Panel title="Resolved by the app">
          <pre className="adm-pre">
            {JSON.stringify(
              {
                ...data.resolved,
                trustProxySetting: data.trustProxySetting,
                trustCloudflareHeaders: data.trustCloudflareHeaders,
                socketRemoteAddress: data.socketRemoteAddress,
              },
              null,
              2
            )}
          </pre>
        </Panel>
        <Panel title="Forwarding headers received">
          <pre className="adm-pre">{JSON.stringify(data.headers, null, 2)}</pre>
        </Panel>
      </div>
    </div>
  );
}
