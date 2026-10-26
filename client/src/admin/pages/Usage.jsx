import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { BarList, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { fmtBucketMs, fmtInt, fmtMs, fmtTime } from '../format.js';

const DAILY_SERIES = [{ label: 'Active configs' }, { label: 'Manifest fetches', color: '#4ade80' }];
const ACTIVITY_SERIES = [{ label: 'Configs by last update', color: '#c084fc' }];

const toDay = (value) => Math.floor(new Date(value).getTime() / 1000);

export function Usage({ range, meta }) {
  const caps = meta?.capabilities;
  const formatPercentile = caps?.approximatePercentiles ? fmtBucketMs : fmtMs;
  const overview = useAsync(() => adminApi.overview({ range }), [range]);
  const usage = useAsync(() => adminApi.usage({ range }), [range]);

  const charts = useMemo(() => {
    const daily = usage.data?.traffic?.daily || [];
    const activity = usage.data?.business?.configActivity || [];
    return {
      daily: [
        daily.map((d) => toDay(d.day)),
        daily.map((d) => Number(d.users)),
        daily.map((d) => Number(d.manifest_fetches)),
      ],
      activity: [activity.map((d) => toDay(d.day)), activity.map((d) => Number(d.updated))],
    };
  }, [usage.data]);

  const b = overview.data?.breakdowns;
  const business = usage.data?.business;
  const go = (key, value) => navigate('requests', { range, [key]: value });

  return (
    <div className="adm-stack">
      <ErrorNote error={overview.error || usage.error} />

      {business && (
        <>
          <div className="adm-stats">
            <StatCard
              label="Configs"
              value={fmtInt(business.summary.configs)}
              sub={`${fmtInt(business.summary.api_keys)} distinct TMDB keys`}
            />
            <StatCard label="Catalogs" value={fmtInt(business.summary.catalogs)} />
            <StatCard
              label="Configs last updated (24h)"
              value={fmtInt(business.summary.updated_1d)}
            />
            <StatCard
              label="Configs last updated (7d)"
              value={fmtInt(business.summary.updated_7d)}
            />
            <StatCard
              label="Configs last updated (30d)"
              value={fmtInt(business.summary.updated_30d)}
            />
            {business.marketplace.totals && (
              <StatCard
                label="Marketplace"
                value={fmtInt(business.marketplace.totals.entries)}
                sub={`${fmtInt(business.marketplace.totals.installs)} installs · ${fmtInt(business.marketplace.totals.likes)} likes`}
              />
            )}
          </div>
          <Panel title="Configs by last update date (30d)">
            <TimeChart data={charts.activity} series={ACTIVITY_SERIES} height={180} />
          </Panel>
        </>
      )}

      {usage.data?.traffic && (
        <Panel title="Daily active configs (requests carrying a config ID)">
          <TimeChart data={charts.daily} series={DAILY_SERIES} height={200} />
        </Panel>
      )}

      {overview.loading && !b ? (
        <Loading />
      ) : (
        b && (
          <div className="adm-grid-3">
            <Panel title="Catalog sources requested">
              <BarList items={b.sources} onSelect={(v) => go('source', v)} />
            </Panel>
            <Panel title="Content types">
              <BarList items={b.contentTypes} />
            </Panel>
            <Panel title="Clients">
              <BarList items={b.clients} onSelect={(v) => go('client', v)} />
            </Panel>
            {caps?.cloudflare && (
              <Panel title="Countries (Cloudflare)">
                <BarList
                  items={b.countries}
                  onSelect={(v) => go('country', v)}
                  empty="No CF-IPCountry header seen"
                />
              </Panel>
            )}
            {caps?.cloudflare && (
              <Panel title="Cloudflare edge locations">
                <BarList items={b.colos} empty="No CF-Ray header seen" />
              </Panel>
            )}
            {caps?.sharedLive && (
              <Panel title="Instances">
                <BarList items={b.instances} onSelect={(v) => go('instance', v)} />
              </Panel>
            )}
          </div>
        )
      )}

      {usage.data?.traffic && (
        <Panel title="Top catalogs by requests">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Catalog ID</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th className="num">Requests</th>
                  <th className="num">Configs</th>
                  <th className="num">5xx</th>
                  <th className="num">p95</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.traffic.topCatalogs.map((c) => (
                  <tr
                    key={`${c.catalog_id}-${c.content_type}`}
                    className="adm-clickable"
                    onClick={() => go('q', c.catalog_id)}
                  >
                    <td className="mono adm-ellipsis">{c.catalog_id}</td>
                    <td>{c.source}</td>
                    <td>{c.content_type}</td>
                    <td className="num">{fmtInt(c.requests)}</td>
                    <td className="num">{fmtInt(c.users)}</td>
                    <td className={`num ${Number(c.errors) ? 'adm-text-bad' : ''}`}>
                      {fmtInt(c.errors ?? 0)}
                    </td>
                    <td className="num">{formatPercentile(c.p95_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {business && (
        <div className="adm-grid-3">
          <Panel title="Saved catalogs by source / type">
            <BarList
              items={business.catalogsBySource.map((r) => ({
                key: `${r.source} · ${r.type}`,
                count: Number(r.count),
              }))}
            />
          </Panel>
          <Panel title="Most used filters">
            <BarList
              items={business.popularFilters.map((r) => ({ key: r.key, count: Number(r.count) }))}
            />
          </Panel>
          <Panel title="Preferences & keys">
            <BarList
              items={Object.entries(business.preferences || {}).map(([key, count]) => ({
                key,
                count: Number(count),
              }))}
            />
          </Panel>
        </div>
      )}

      {business?.marketplace?.top?.length > 0 && (
        <Panel title="Top marketplace catalogs">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th className="num">Installs</th>
                  <th className="num">Likes</th>
                  <th className="num">Views</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {business.marketplace.top.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td>
                    <td>{m.source}</td>
                    <td>{m.type}</td>
                    <td className="num">{fmtInt(m.installs)}</td>
                    <td className="num">{fmtInt(m.likes)}</td>
                    <td className="num">{fmtInt(m.views)}</td>
                    <td className="nowrap">{fmtTime(m.published_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!usage.loading && !usage.data?.business && (
        <div className="adm-alert adm-tone-warn">
          Config analytics are unavailable while collection is disabled.
        </div>
      )}
    </div>
  );
}
