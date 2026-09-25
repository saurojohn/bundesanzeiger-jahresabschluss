'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { MandantSwitcher } from './MandantSwitcher';

type SessionUser = {
  id: string;
  email: string;
  vorname: string;
  nachname: string;
  globalRole: 'USER' | 'SYSTEM_ADMIN';
  mandanten: Array<{
    id: string;
    firmenname: string;
    rolle: 'GF' | 'STEUERBERATER' | 'WIRTSCHAFTSPRUEFER' | 'KANZLEI_ADMIN';
  }>;
};

type NavItem = {
  href: string;
  key: string;
  /** Wenn gesetzt, wird das Item nur für diese Rollen angezeigt. */
  visibleFor?: ReadonlyArray<'GF' | 'STEUERBERATER' | 'WIRTSCHAFTSPRUEFER' | 'KANZLEI_ADMIN' | 'SYSTEM_ADMIN'>;
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/dashboard', key: 'dashboard' },
  { href: '/bilanz', key: 'bilanz' },
  { href: '/guv', key: 'guv' },
  { href: '/anhang', key: 'anhang' },
  { href: '/jahresabschluss', key: 'jahresabschluss' },
  { href: '/konsolidierung', key: 'konsolidierung' },
  { href: '/wp', key: 'wp' },
  { href: '/audit', key: 'audit' },
  {
    href: '/einstellungen/subscription',
    key: 'subscription',
    visibleFor: ['KANZLEI_ADMIN', 'SYSTEM_ADMIN'],
  },
  {
    href: '/branding',
    key: 'branding',
    visibleFor: ['KANZLEI_ADMIN'],
  },
  {
    href: '/api-keys',
    key: 'apiKeys',
    visibleFor: ['KANZLEI_ADMIN'],
  },
] as const;

/**
 * Prüft, ob ein Nav-Item für den aktuellen User sichtbar ist.
 *
 * SYSTEM_ADMIN sieht alle Items (auch ohne visibleFor).
 * Andere Rollen sehen Items nur, wenn ihre Rollen in visibleFor enthalten sind.
 */
function isItemVisible(item: NavItem, user: SessionUser | null): boolean {
  if (!item.visibleFor) return true;
  if (!user) return false;
  if (user.globalRole === 'SYSTEM_ADMIN') return true;
  const userRoles = user.mandanten.map((m) => m.rolle);
  return userRoles.some((r) => item.visibleFor?.includes(r));
}

export function AppHeader() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mobile-Menü schließen wenn Route wechselt
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          router.push('/de-DE/login');
          return;
        }
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          router.push('/de-DE/login');
          return;
        }
        if (!cancelled) {
          setUser(await response.json());
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          router.push('/de-DE/login');
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Ignore network errors on logout
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    router.push('/de-DE/login');
  }

  if (loading) {
    return (
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-7xl mx-auto text-sm text-slate-500">
          {t('common.loading')}
        </div>
      </header>
    );
  }

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 lg:gap-6">
          <span className="font-semibold text-slate-900 truncate">
            {t('common.appName')}
          </span>
          {/* MandantSwitcher auf Mobile ausblenden (zu breit) */}
          <div className="hidden lg:block">
            <MandantSwitcher userMandanten={user?.mandanten ?? []} />
          </div>
        </div>

        {/* Desktop-Navigation: ab lg sichtbar */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_ITEMS.filter((item) => isItemVisible(item, user)).map((item) => {
            const href = `/de-DE${item.href}`;
            const active = pathname?.endsWith(item.href) ?? false;
            return (
              <a
                key={item.key}
                href={href}
                className={
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors ' +
                  (active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                }
              >
                {t(`navigation.${item.key}`)}
              </a>
            );
          })}
        </nav>

        {/* User-Info + Logout: nur Desktop */}
        <div className="hidden lg:flex items-center gap-4">
          {user && (
            <div className="text-right text-sm">
              <div className="font-medium text-slate-900">
                {user.vorname} {user.nachname}
              </div>
              <div className="text-xs text-slate-500">{user.email}</div>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {t('common.logout')}
          </button>
        </div>

        {/* Hamburger-Button: nur Mobile */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((o) => !o)}
          className="lg:hidden flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          aria-label={mobileMenuOpen ? 'Menü schließen' : 'Menü öffnen'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
        >
          {mobileMenuOpen ? (
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile-Menü: Slide-Down unter dem Header */}
      {mobileMenuOpen && (
        <div
          id="mobile-menu"
          className="lg:hidden border-t border-slate-200 bg-white"
        >
          <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
            {/* MandantSwitcher auf Mobile */}
            <div className="lg:hidden">
              <MandantSwitcher userMandanten={user?.mandanten ?? []} />
            </div>

            {/* Nav-Items: vertikal statt horizontal */}
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.filter((item) => isItemVisible(item, user)).map((item) => {
                const href = `/de-DE${item.href}`;
                const active = pathname?.endsWith(item.href) ?? false;
                return (
                  <a
                    key={item.key}
                    href={href}
                    className={
                      'block px-3 py-2.5 rounded-md text-base font-medium transition-colors ' +
                      (active
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-700 hover:bg-slate-100')
                    }
                  >
                    {t(`navigation.${item.key}`)}
                  </a>
                );
              })}
            </nav>

            {/* User-Info + Logout am Ende */}
            {user && (
              <div className="border-t border-slate-200 pt-3">
                <div className="px-3 text-sm">
                  <div className="font-medium text-slate-900">
                    {user.vorname} {user.nachname}
                  </div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-3 w-full rounded-md bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  {t('common.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}