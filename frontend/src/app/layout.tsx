import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bundesanzeiger Jahresabschluss',
  description:
    'Veröffentlichungspipeline für Jahresabschlüsse im Bundesanzeiger (§§ 325-326 HGB)',
  applicationName: 'Bundesanzeiger Jahresabschluss',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'BAnz-JA',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#2563eb',
};

/**
 * Root-Layout (App Router).
 *
 * Inkludiert:
 *   - Globale CSS-Datei mit Mobile-Touch-Optimierungen (M4 Sprint 4)
 *   - PWA-Manifest + Theme-Color (M4 Sprint 4)
 *   - Service-Worker-Registrierung via `<ServiceWorkerRegistrar />`
 *
 * Der ServiceWorkerRegistrar wird client-seitig eingebunden (im App-Layout),
 * nicht hier, da Root-Layout Server-Component ist.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}