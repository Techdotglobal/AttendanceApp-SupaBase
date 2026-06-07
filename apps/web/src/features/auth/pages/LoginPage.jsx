import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const LOGO_PATH = '/logo.jpeg';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, error } = useAuthStore();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [logoSrc, setLogoSrc] = useState(LOGO_PATH);

  const onSubmit = async (e) => {
    e.preventDefault();
    const result = await login(usernameOrEmail, password);
    if (!result.success) return;
    navigate('/');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#3B82F6_0%,#2563EB_35%,#0F172A_100%)]" />
      <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full bg-blue-400/20 blur-3xl animate-float-slow" />
      <div className="absolute -right-24 bottom-0 h-[28rem] w-[28rem] rounded-full bg-blue-300/20 blur-3xl animate-float-slower" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/20 to-slate-950/50" />

      <div className="relative z-10 min-h-screen px-4 py-8 flex items-center justify-center">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-6 flex justify-center animate-fade-in">
            <img
              src={logoSrc}
              alt="Hadir.ai Logo"
              className="h-16 w-16 rounded-2xl object-cover border border-white/20 shadow-lg"
              onError={() => setLogoSrc('/logo.jpeg')}
            />
          </div>

          <form
            className="rounded-2xl border border-white/20 bg-white/12 backdrop-blur-xl p-6 md:p-7 shadow-xl space-y-4"
            onSubmit={onSubmit}
          >
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome back</h1>
              <p className="text-sm text-blue-100/90">Sign in to your admin panel</p>
            </div>

            <input
              className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-3 text-white placeholder:text-blue-100/70 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40 transition-all duration-200"
              placeholder="Email or username"
              value={usernameOrEmail}
              onChange={(e) => setUsernameOrEmail(e.target.value)}
            />

            <div className="relative">
              <input
                className="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-3 pr-14 text-white placeholder:text-blue-100/70 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40 transition-all duration-200"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-xs text-blue-100 hover:text-white hover:bg-white/10 transition-all duration-200"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 text-blue-100">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border border-white/30 bg-white/10 text-blue-500 focus:ring-blue-300/40"
                />
                Remember me
              </label>
              <a href="#" className="text-blue-100 hover:text-white transition-colors duration-200">
                Forgot password?
              </a>
            </div>

            {error && <p className="text-red-200 text-sm">{error}</p>}

            <button
              className="w-full rounded-xl bg-blue-600 p-3 font-medium text-white hover:bg-blue-700 active:scale-[0.99] transition-all duration-200 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
