import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { AdminUser, setToken, setUser } from '../lib/auth';

interface AuthResponse {
  token: string;
  user: AdminUser;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<AuthResponse>('/auth/login', { email, password });
      if (!res.user.isAdmin) {
        setError('This account is not an admin.');
        return;
      }
      setToken(res.token);
      setUser(res.user);
      navigate('/auctions', { replace: true });
    } catch (e) {
      const msg = e instanceof ApiError ? (e.status === 401 ? 'invalid credentials' : e.message) : 'login failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-indigo to-brand-indigo-dark p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8"
      >
        <div className="text-brand-indigo-dark text-2xl font-semibold">Kalki Bet · Admin</div>
        <p className="text-sm text-slate-500 mt-1 mb-6">Sign in with your admin account</p>

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

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
