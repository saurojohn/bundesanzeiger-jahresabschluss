import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  const t = useTranslations();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">
            {t('auth.login.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {t('auth.login.subtitle')}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          {t('common.appName')} · {t('common.appTagline')}
        </p>
      </div>
    </div>
  );
}