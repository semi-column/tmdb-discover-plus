import { useState } from 'react';
import { adminApi } from '../api.js';
import { Activity, ArrowRight } from 'lucide-react';

export function Login({ totpRequired, onSuccess }) {
  const [form, setForm] = useState({ username: '', password: '', totp: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.login(form);
      setForm({ username: '', password: '', totp: '' });
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <div className="adm-login-brand">
          <span className="adm-brand-mark">
            <Activity size={20} aria-hidden="true" />
          </span>
          <span>
            TMDB Discover+<small>OPERATIONS</small>
          </span>
        </div>
        <h1>Admin sign in</h1>
        <label>
          Username
          <input autoComplete="username" required {...field('username')} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required {...field('password')} />
        </label>
        {totpRequired && (
          <label>
            Authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              {...field('totp')}
            />
          </label>
        )}
        {error && (
          <div role="alert" className="adm-alert adm-tone-bad">
            {error}
          </div>
        )}
        <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
          {busy ? (
            'Signing in…'
          ) : (
            <>
              Sign in <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
