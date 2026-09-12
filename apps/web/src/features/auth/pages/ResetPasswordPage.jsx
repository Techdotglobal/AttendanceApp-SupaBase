import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/config/supabase';
import { HalftoneAura } from '../../../shared/components/HalftoneAura';
import { Alert } from '../../../shared/components/ui/Alert';
import { PasswordInput } from '../../../shared/components/PasswordInput';

const LOGO_PATH = '/logo.jpeg';

/**
 * Web password-reset landing page. Supabase's client exchanges the recovery
 * token in the URL for a session automatically (detectSessionInUrl) and fires
 * a PASSWORD_RECOVERY auth event — that event, not a fixed timeout, is what
 * tells us the link is valid and the form can be shown.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking'); // checking | ready | invalid
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready');
      }
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data?.session) {
        setStatus('ready');
      } else {
        setStatus((current) => (current === 'checking' ? 'invalid' : current));
      }
    })();

    return () => {
      cancelled = true;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Failed to reset password. Please try again.');
    } finally {
      setSubmitting(false);
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
            {status === 'checking' && (
              <div className="space-y-1.5 text-center">
                <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                  Verifying link…
                </h1>
                <p className="text-[14px] font-medium text-[#64748B]">
                  Hang on while we confirm your reset link.
                </p>
              </div>
            )}

            {status === 'invalid' && (
              <div className="space-y-4 text-center">
                <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                  Invalid or expired link
                </h1>
                <p className="text-[14px] font-medium text-[#64748B]">
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#00BFFF] text-[15px] font-semibold text-white transition hover:bg-[#00A9E0]"
                >
                  Request new link
                </Link>
              </div>
            )}

            {status === 'ready' && !done && (
              <>
                <div className="space-y-1.5 text-center sm:text-left">
                  <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                    Set a new password
                  </h1>
                  <p className="text-[14px] font-medium text-[#64748B]">
                    Choose a new password for your account.
                  </p>
                </div>

                {error && (
                  <div className="mt-5">
                    <Alert type="error">{error}</Alert>
                  </div>
                )}

                <form onSubmit={onSubmit} className="mt-7 space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">New password</span>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password (min. 6 characters)"
                      minLength={6}
                      required
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">Confirm password</span>
                    <PasswordInput
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      minLength={6}
                      required
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#00BFFF] text-[15px] font-semibold text-white transition hover:bg-[#00A9E0] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? 'Saving…' : 'Reset password'}
                  </button>
                </form>
              </>
            )}

            {done && (
              <div className="space-y-4 text-center">
                <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0F172A]">
                  Password updated
                </h1>
                <p className="text-[14px] font-medium text-[#64748B]">
                  Your password has been changed successfully. You can now sign in.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#00BFFF] text-[15px] font-semibold text-white transition hover:bg-[#00A9E0]"
                >
                  Go to sign in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
