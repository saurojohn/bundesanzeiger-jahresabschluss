import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Single locale for now: de-DE. M3 may add en-US for international clients.
  return {
    locale: 'de-DE',
    messages: (await import('../messages/de-DE.json')).default,
  };
});