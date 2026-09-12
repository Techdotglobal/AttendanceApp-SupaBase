import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { HalftoneAura } from '../../../shared/components/HalftoneAura';
import { Alert } from '../../../shared/components/ui/Alert';

const LOGO_PATH = '/logo.jpeg';

/** Set to true to show Google / Apple sign-in and the "Or with" divider. */
const SHOW_SOCIAL_AUTH = false;

const FIELD =
  'h-12 w-full rounded-2xl border border-[#C2ECF9] bg-[#F8FCFD] px-4 text-[15px] font-medium text-[#0F172A] outline-none transition placeholder:font-normal placeholder:text-[#94A3B8] focus:border-[#00BFFF] focus:bg-white focus:ring-[3px] focus:ring-[rgba(0,191,255,0.25)]';

function GoogleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="#70C9EF">
      <path d="M16.37 12.68c.03 3.14 2.75 4.19 2.78 4.2-.02.07-.43 1.49-1.43 2.95-.86 1.26-1.76 2.52-3.17 2.55-1.39.03-1.84-.83-3.43-.83-1.59 0-2.09.8-3.4.85-1.37.05-2.41-1.36-3.29-2.61-1.79-2.56-3.16-7.24-1.32-9.82.91-1.28 2.54-2.09 4.31-2.12 1.34-.03 2.61.91 3.43.91.82 0 2.36-1.12 3.98-.96.68.03 2.58.27 3.8 2.07-.1.06-2.27 1.32-2.26 3.81zM13.9 5.4c.73-.88 1.21-2.1 1.08-3.32-1.04.04-2.3.7-3.05 1.57-.67.77-1.26 2.01-1.1 3.19 1.17.09 2.35-.59 3.07-1.44z" />
    </svg>
  );
}

/**
 * Premium centered Sign In — dotted cyan aura, floating white card, vivid cyan CTA.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, error } = useAuthStore();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    const result = await login(usernameOrEmail, password);
    if (!result.success) return;
    navigate('/dashboard');
  };

  return (
    <div className="auth-page relative min-h-dvh bg-[#F8FCFD]">
      <HalftoneAura />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-[26.5rem] animate-fade-up">
          {!logoFailed && (
            <div className="mb-7 flex justify-center">
              <img
                src={LOGO_PATH}
                alt="Hadir.ai"
                className="h-16 w-16 rounded-[1.25rem] border border-white object-cover shadow-[0_12px_32px_-8px_rgba(0,136,199,0.28)]"
                onError={() => setLogoFailed(true)}
              />
            </div>
          )}

          <form
            onSubmit={onSubmit}
            className="rounded-[2rem] border border-white/80 bg-white/95 p-8 shadow-[0_24px_60px_-18px_rgba(15,40,47,0.18),0_8px_24px_-10px_rgba(0,191,255,0.12)] backdrop-blur-sm sm:p-10"
          >
            <div className="space-y-1.5 text-center sm:text-left">
              <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                Welcome back
              </h1>
              <p className="text-[14px] font-medium text-[#64748B]">
                Sign in to your admin portal
              </p>
            </div>

            {error && (
              <div className="mt-5">
                <Alert type="error">{error}</Alert>
              </div>
            )}

            <div className="mt-7 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[13px] font-semibold text-[#0F172A]">Email</span>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="username"
                  required
                  className={FIELD}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[13px] font-semibold text-[#0F172A]">Password</span>
                <span className="relative block">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    className={`${FIELD} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-[#64748B] transition hover:bg-[#E0F6FC] hover:text-[#0F172A]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" strokeWidth={1.9} />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={1.9} />
                    )}
                  </button>
                </span>
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#64748B]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="ui-checkbox"
                />
                Remember me
              </label>
              <Link
                to="/forgot-password"
                className="text-[13px] font-semibold text-accent-600 transition hover:text-accent-700"
              >
                Forgot password?
              </Link>
            </div>

            {SHOW_SOCIAL_AUTH && (
              <>
                <div className="relative my-7">
                  <div className="absolute inset-0 flex items-center" aria-hidden>
                    <div className="w-full border-t border-[#DCEFF7]" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">
                      Or with
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#DCEFF7] bg-white text-[13px] font-semibold text-[#0F172A] transition hover:border-[#70C9EF] hover:bg-[#E6F4FA]"
                  >
                    <GoogleIcon className="h-5 w-5" />
                    Google
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#DCEFF7] bg-white text-[13px] font-semibold text-[#0F172A] transition hover:border-[#70C9EF] hover:bg-[#E6F4FA]"
                  >
                    <AppleIcon className="h-5 w-5" />
                    Apple
                  </button>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`${SHOW_SOCIAL_AUTH ? 'mt-6' : 'mt-8'} inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#00BFFF] text-[15px] font-bold text-white shadow-[0_12px_28px_-8px_rgba(0,191,255,0.45)] transition hover:bg-[#00A8E6] hover:shadow-[0_16px_34px_-8px_rgba(0,168,230,0.4)] active:translate-y-px active:bg-[#00A8E6] disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <p className="mt-7 text-center text-[13px] text-[#64748B]">
              Don&apos;t have an account?{' '}
              <Link to="/onboard" className="font-bold text-accent-600 hover:text-accent-700">
                Sign Up
              </Link>
            </p>
          </form>

          <p className="mt-6 text-center">
            <Link
              to="/"
              className="text-[13px] font-semibold text-[#64748B] transition hover:text-[#0F172A]"
            >
              Back to home
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
