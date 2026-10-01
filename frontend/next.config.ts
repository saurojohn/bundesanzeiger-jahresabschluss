import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * `output: 'standalone'` erzeugt einen self-contained Server unter
 * `.next/standalone`. Damit die Trace-Dateien korrekt aufgelöst werden,
 * muss Next.js wissen, wo das Projekt-Root liegt.
 *
 * Ohne dieses Feld sucht Next.js nach mehreren `package-lock.json` im
 * Dateisystem und kann den falschen Ordner wählen — der Build läuft dann
 * zwar durch, der Standalone-Server findet seine Assets aber nicht mehr
 * und antwortet mit 500.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  reactStrictMode: true,
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
