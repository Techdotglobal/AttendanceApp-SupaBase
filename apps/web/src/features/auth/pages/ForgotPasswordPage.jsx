import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../core/config/supabase';
import { HalftoneAura } from '../../../shared/components/HalftoneAura';
import { Alert } from '../../../shared/components/ui/Alert';

const LOGO_PATH = '/logo.jpeg';

const FIELD =
  'h-12 w-full rounded-2xl border border-[#C2ECF9] bg-[#F8FCFD] px-4 text-[15px] font-medium text-[#0F172A] outline-none transition placeholder:font-normal placeholder:text-[#94A3B8] focus:border-[#00BFFF] focus:bg-white focus:ring-[3px] focus:ring-[rgba(0,191,255,0.25)]';

/**
 * Web password-reset request page. Sends the Supabase recovery email with a
 * redirect back into this web app's /reset-password route — never the mobile
 * `hadirai://reset-password` deep link.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (err) {
      setError(err?.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page relative min-h-dvh bg-[#F8FCFD]">
      <HalftoneAura />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-[26.5rem] animate-fade-up">
          <div className="mb-7 flex justify-center">
            <img
              src={LOGO_PATH}
              alt="Hadir.ai"
              className="h-16 w-16 rounded-[1.25rem] border border-white object-cover shadow-[0_12px_32px_-8px_rgba(0,136,199,0.28)]"
            />
          </div>

          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-8 shadow-[0_24px_60px_-18px_rgba(15,40,47,0.18),0_8px_24px_-10px_rgba(0,191,255,0.12)] backdrop-blur-sm sm:p-10">
            <div className="space-y-1.5 text-center sm:text-left">
              <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                Reset your password
              </h1>
              <p className="text-[14px] font-medium text-[#64748B]">
                {sent
                  ? 'Check your inbox for a link to reset your password.'
                  : "Enter the email on your account and we'll send you a reset link."}
              </p>
            </div>

            {error && (
              <div className="mt-5">
                <Alert type="error">{error}</Alert>
              </div>
            )}

            {sent ? (
              <div className="mt-7 space-y-1.5">
                <span className="text-[13px] font-semibold text-[#0F172A]">Email sent</span>
                <p className="text-[13px] font-medium text-[#64748B]">
                  If an account exists for <span className="font-semibold">{email}</span>, a
                  password reset link is on its way.
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="mt-7 space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                    className={FIELD}
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#00BFFF] text-[15px] font-semibold text-white transition hover:bg-[#00A9E0] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="text-[13px] font-semibold text-accent-600 transition hover:text-accent-700"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
