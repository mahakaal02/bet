import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { AdminUser, setUser } from '../lib/auth';

/**
 * Two response shapes from /auth/admin/login:
 *
 *   - `{ user }`              — happy path (no 2FA). The session
 *                               cookie was set in the response
 *                               headers; we just store the displayed
 *                               user + navigate.
 *   - `{ needs2FA: true,
 *        challengeToken }`    — admin has 2FA on. The SPA flips into
 *                               a 6-digit code prompt + POSTs
 *                               `/auth/admin/login/2fa` to finish.
 */
type AdminLoginResponse =
  | { user: AdminUser }
  | { needs2FA: true; challengeToken: string };

interface TwoFactorResponse {
  user: AdminUser;
  // We don't surface trustedDevice yet on the admin surface — but
  // accept it in the type so the runtime parse doesn't reject the
  // extra field.
  trustedDevice?: unknown;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 2FA challenge state — set after the first POST when the account
  // has 2FA enabled. UI swaps to the code prompt.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<AdminLoginResponse>('/auth/admin/login', {
        email,
        password,
      });
      if ('needs2FA' in res) {
        setChallengeToken(res.challengeToken);
        return;
      }
      if (!res.user.isAdmin) {
        // Defence in depth — backend already enforces isAdmin, but
        // we re-check here so a misconfigured deploy doesn't drop
        // a non-admin into the admin SPA.
        setError('This account is not an admin.');
        return;
      }
      setUser(res.user);
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError('invalid credentials');
        else if (e.status === 403) setError('admin access required');
        else setError(e.message);
      } else {
        setError('login failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit2FA(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<TwoFactorResponse>('/auth/admin/login/2fa', {
        challengeToken,
        code,
      });
      if (!res.user.isAdmin) {
        setError('This account is not an admin.');
        return;
      }
      setUser(res.user);
      navigate('/', { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? 'invalid code'
            : e.message
          : '2FA failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-indigo to-brand-indigo-dark p-6">
      <form
        onSubmit={challengeToken ? onSubmit2FA : onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8"
      >
        <div className="text-brand-indigo-dark text-2xl font-semibold">Kalki Bet · Admin</div>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          {challengeToken
            ? 'Enter your 6-digit authenticator code'
            : 'Sign in with your admin account'}
        </p>

        {!challengeToken && (
          <>
            <label className="block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-indigo"
            />

            <label className="block text-xs font-medium text-slate-600 mt-4">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-indigo"
            />
          </>
        )}

        {challengeToken && (
          <>
            <label className="block text-xs font-medium text-slate-600">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              maxLength={8}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-indigo tracking-widest text-center text-lg"
              autoFocus
            />
            <p className="mt-2 text-xs text-slate-500">
              You can also enter an 8-character backup code if you've lost your authenticator.
            </p>
          </>
        )}

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : challengeToken ? 'Verify' : 'Sign in'}
        </button>

        {challengeToken && (
          <button
            type="button"
            onClick={() => {
              setChallengeToken(null);
              setCode('');
              setError(null);
            }}
            className="mt-3 w-full py-2 text-xs text-slate-500 hover:text-slate-700"
          >
            ← back to email + password
          </button>
        )}
      </form>
    </div>
  );
}
