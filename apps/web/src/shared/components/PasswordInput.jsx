import { useState } from 'react';

/**
 * Password field with show/hide toggle (eye button).
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  minLength,
  autoComplete = 'new-password',
  className = '',
  id,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        minLength={minLength}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 pr-11 text-sm text-slate-100 placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.2 11.2 0 0 1-2.1 3.6" />
            <path d="M6.2 6.2A11.5 11.5 0 0 0 1 12.5C2.7 16.9 7 20 12 20a10.8 10.8 0 0 0 4.2-.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 12.5C3.7 8.1 8 5 13 5s9.3 3.1 11 7.5" />
            <path d="M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}
