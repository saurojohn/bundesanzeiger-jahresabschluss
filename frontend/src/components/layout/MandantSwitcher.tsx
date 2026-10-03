'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

type MandantAccess = {
  id: string;
  firmenname: string;
  rolle: 'GF' | 'STEUERBERATER' | 'WIRTSCHAFTSPRUEFER' | 'KANZLEI_ADMIN';
};

export function MandantSwitcher({
  userMandanten,
}: {
  userMandanten: MandantAccess[];
}) {
  const t = useTranslations();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined'
      ? localStorage.getItem('activeMandantId')
      : null;
    if (stored && userMandanten.some((m) => m.id === stored)) {
      setActiveId(stored);
    } else if (userMandanten.length > 0) {
      // Auch der Vorauswahl-Wert muss persistiert werden. Bis 2026-10-03
      // wurde hier nur der React-State gesetzt, localStorage blieb leer —
      // damit fehlte `apiFetch` der aktive Mandant und jeder Aufruf ohne
      // explizites `mandantId` (Detailansicht, Löschen, Speichern) lief in
      // 403 "mandantId erforderlich". Geschrieben wurde nur beim manuellen
      // Wechseln über das Dropdown.
      const initial = userMandanten[0].id;
      setActiveId(initial);
      localStorage.setItem('activeMandantId', initial);
    }
  }, [userMandanten]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setActiveId(id);
    localStorage.setItem('activeMandantId', id);
    // Trigger page reload to apply new context
    window.location.reload();
  }

  if (userMandanten.length === 0) {
    return (
      <span className="text-xs text-slate-500">
        {t('dashboard.noMandantSelected')}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="mandant-switcher"
        className="text-sm text-slate-600 whitespace-nowrap"
      >
        {t('dashboard.activeMandant')}:
      </label>
      <select
        id="mandant-switcher"
        value={activeId ?? ''}
        onChange={handleChange}
        className="rounded-md border border-slate-300 px-3 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {userMandanten.map((m) => (
          <option key={m.id} value={m.id}>
            {m.firmenname} ({m.rolle})
          </option>
        ))}
      </select>
    </div>
  );
}