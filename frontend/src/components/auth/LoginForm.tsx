'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

type LoginState = 'idle' | 'submitting' | 'totp_required' | 'error';

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [state, setState] = useState<LoginState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('submitting');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          totpCode: totpCode || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setState('error');
        if (data.code === 'TOTP_REQUIRED') {
          setState('totp_required');
          setErrorMessage(null);
          return;
        }
        setErrorMessage(
          data.message || t('auth.login.errors.invalidCredentials'),
        );
        return;
      }

      const data = await response.json();
      // Persist tokens
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      // Redirect to dashboard
      router.push('/de-DE/dashboard');
    } catch (err) {
      setState('error');
      setErrorMessage(t('auth.login.errors.unknown'));
    }
  }

  const showTotpField = state === 'totp_required' || totpCode.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          {t('auth.login.email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.login.emailPlaceholder')}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          disabled={state === 'submitting'}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          {t('auth.login.password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.login.passwordPlaceholder')}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          disabled={state === 'submitting'}
        />
      </div>

      {showTotpField && (
        <div>
          <label
            htmlFor="totpCode"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            {t('auth.login.totpCode')}
          </label>
          <input
            id="totpCode"
            name="totpCode"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(e) =>
              setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder={t('auth.login.totpPlaceholder')}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 num-de tracking-widest text-center"
            disabled={state === 'submitting'}
          />
          <p className="mt-1 text-xs text-slate-500">
            {t('auth.login.totpHelp')}
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700"
        >
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={state === 'submitting'}
        className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === 'submitting'
          ? t('auth.login.submitting')
          : t('auth.login.submit')}
      </button>

      <div className="text-center">
        <a
          href="#"
          className="text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.preventDefault()}
        >
          {t('auth.login.forgotPassword')}
        </a>
      </div>
    </form>
  );
}