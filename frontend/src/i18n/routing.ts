import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['de-DE'] as const,
  defaultLocale: 'de-DE' as const,
});