import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, IS_API_GATEWAY_CONFIGURED } from '../../../core/config/api';

const LOGO_PATH = '/logo.jpeg';

export function CompanyOnboardingPage() {
  const [logoSrc, setLogoSrc] = useState(LOGO_PATH);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [requiresKey, setRequiresKey] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [superAdminName, setSuperAdminName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [onboardingKey, setOnboardingKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    if (!IS_API_GATEWAY_CONFIGURED) {
      setStatusError('API gateway URL is not configured (set VITE_API_GATEWAY_URL).');
      setStatusLoading(false);
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/auth/onboarding-status'));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not load onboarding status');
      }
      setBootstrapAvailable(Boolean(data.bootstrapAvailable));
      setRequiresKey(Boolean(data.requiresOnboardingKey));
    } catch (e) {
      setStatusError(e.message || 'Network error');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccess(null);
    if (!IS_API_GATEWAY_CONFIGURED) {
      setFormError('API gateway URL is not configured.');
      return;
    }
    if (requiresKey && !onboardingKey.trim()) {
      setFormError('Onboarding key is required for additional companies.');
      return;
    }
    setSubmitting(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (requiresKey && onboardingKey.trim()) {
        headers['X-Onboarding-Key'] = onboardingKey.trim();
      }
      const res = await fetch(apiUrl('/api/auth/onboard-company'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: companyName.trim(),
          superAdminName: superAdminName.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
      }
      setSuccess(data);
      setPassword('');
    } catch (err) {
      setFormError(err.message || 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#3B82F6_0%,#2563EB_35%,#0F172A_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/20 to-slate-950/50" />

      <div className="relative z-10 min-h-screen px-4 py-8 flex items-center justify-center">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-6 flex justify-center">
            <img
              src={logoSrc}
              alt="Logo"
              className="h-16 w-16 rounded-2xl object-cover border border-white/20 shadow-lg"
              onError={() => setLogoSrc('/logo.jpeg')}
            />
          </div>

          {success ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-950/40 backdrop-blur-xl p-6 shadow-xl space-y-3 text-emerald-50">
              <h1 className="text-2xl font-semibold">Company ready</h1>
              <p className="text-sm text-emerald-100/90">
                {success.company?.name} is set up. Sign in as <strong>{success.user?.username}</strong> using the
                password you chose.
              </p>
              <Link
                to="/login"
                className="inline-flex mt-2 rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <form
              className="rounded-2xl border border-white/20 bg-white/12 backdrop-blur-xl p-6 md:p-7 shadow-xl space-y-4"
              onSubmit={onSubmit}
            >
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-white">Create company</h1>
                <p className="text-sm text-blue-100/90">
                  Register a new tenant with a Management department and super admin.
                </p>
              </div>

              {statusLoading && <p className="text-sm text-blue-100/80">Checking onboarding…</p>}
              {statusError && <p className="text-sm text-red-200">{statusError}</p>}
              {!statusLoading && !requiresKey && (
                <p className="text-xs text-emerald-200/90 rounded-lg bg-emerald-900/30 border border-emerald-500/20 px-3 py-2">
                  First company: no server key required. For additional companies, configure{' '}
                  <code className="text-emerald-100">COMPANY_ONBOARDING_SECRET</code> and enter it below.
                </p>
              )}
              {!statusLoading && requiresKey && (
                <label className="block space-y-1">
                  <span className="text-xs text-blue-100/90">Onboarding key (X-Onboarding-Key)</span>
                  <input
                    className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                    placeholder="Server secret from COMPANY_ONBOARDING_SECRET"
                    value={onboardingKey}
                    onChange={(e) => setOnboardingKey(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-xs text-blue-100/90">Company name</span>
                <input
                  required
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                  placeholder="Acme Inc."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-blue-100/90">Super admin full name</span>
                <input
                  required
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                  placeholder="Jane Doe"
                  value={superAdminName}
                  onChange={(e) => setSuperAdminName(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-blue-100/90">Username</span>
                <input
                  required
                  autoCapitalize="none"
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                  placeholder="jane.admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-blue-100/90">Email</span>
                <input
                  required
                  type="email"
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                  placeholder="jane@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-blue-100/90">Password (min 8 characters)</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-100/60 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {formError && <p className="text-sm text-red-200">{formError}</p>}

              <button
                type="submit"
                disabled={submitting || statusLoading}
                className="w-full rounded-xl bg-blue-600 p-3 font-medium text-white hover:bg-blue-700 active:scale-[0.99] transition-all duration-200 disabled:opacity-60"
              >
                {submitting ? 'Creating…' : 'Create company & super admin'}
              </button>

              <p className="text-center text-sm text-blue-100/80">
                <Link to="/login" className="text-white hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
