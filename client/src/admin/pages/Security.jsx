import { useState } from 'react';
import { adminApi } from '../api.js';
import { useAsync } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel } from '../components/ui.jsx';

const SOURCE_LABELS = {
  hash: 'ADMIN_PASSWORD_HASH (scrypt)',
  password: 'ADMIN_PASSWORD (plain env var)',
};

export function Security() {
  const { data, error, loading } = useAsync(() => adminApi.security(), []);
  const [totp, setTotp] = useState(null);
  const [totpError, setTotpError] = useState(null);

  const generate = async () => {
    setTotpError(null);
    try {
      setTotp(await adminApi.generateTotp());
    } catch (err) {
      setTotpError(err);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  return (
    <div className="adm-stack">
      <Panel title="Current settings">
        <ul className="adm-list">
          <li>
            Password from{' '}
            <span className="mono">
              {SOURCE_LABELS[data.credentialSource] ?? data.credentialSource}
            </span>
          </li>
          <li>
            Two-factor (TOTP):{' '}
            <Badge tone={data.totpEnabled ? 'good' : 'warn'}>
              {data.totpEnabled ? 'on' : 'off'}
            </Badge>
          </li>
          <li>
            IP allow-list:{' '}
            {data.allowList.length ? (
              <span className="mono">{data.allowList.join(', ')}</span>
            ) : (
              <Badge tone="muted">any IP</Badge>
            )}
          </li>
          <li>
            Cloudflare headers trusted:{' '}
            <Badge tone={data.trustCloudflareHeaders ? 'good' : 'muted'}>
              {data.trustCloudflareHeaders ? 'yes' : 'no'}
            </Badge>
          </li>
        </ul>
        <p className="adm-muted">
          These come from environment variables. Changing ADMIN_PASSWORD or ADMIN_PASSWORD_HASH
          signs out every session.
        </p>
      </Panel>

      <Panel title="Set up two-factor authentication">
        <ol className="adm-list adm-steps">
          <li>Generate a secret below. It is not saved anywhere by the server.</li>
          <li>
            Add it to your authenticator app (enter the secret manually, or open the otpauth link on
            your phone).
          </li>
          <li>
            Set <span className="mono">ADMIN_TOTP_SECRET</span> to the secret in your deployment and
            restart. From then on login asks for a 6-digit code.
          </li>
        </ol>
        <button type="button" className="adm-btn adm-btn-primary" onClick={generate}>
          {totp ? 'Generate another' : 'Generate secret'}
        </button>
        <ErrorNote error={totpError} />
        {totp && (
          <div className="adm-stack adm-totp">
            <label className="adm-filter">
              <span>ADMIN_TOTP_SECRET</span>
              <input
                className="mono"
                readOnly
                value={totp.secret}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <label className="adm-filter">
              <span>otpauth link</span>
              <input
                className="mono"
                readOnly
                value={totp.otpauthUrl}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <p className="adm-muted">Leaving this page discards the secret. Don't share it.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
