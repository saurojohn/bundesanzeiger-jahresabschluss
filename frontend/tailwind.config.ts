import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // White-Label-fähig: die Brand-Color wird per CSS-Custom-
          // Properties zur Laufzeit überschrieben (siehe AppLayout).
          // Fallback-Werte entsprechen dem bisherigen Default.
          50: 'var(--brand-primary-50, #eff6ff)',
          100: 'var(--brand-primary-100, #dbeafe)',
          500: 'var(--brand-primary-500, #3b82f6)',
          600: 'var(--brand-primary, #2563eb)',
          700: 'var(--brand-primary-hover, #1d4ed8)',
          900: 'var(--brand-primary-900, #1e3a8a)',
          accent: 'var(--brand-accent, #0ea5e9)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;