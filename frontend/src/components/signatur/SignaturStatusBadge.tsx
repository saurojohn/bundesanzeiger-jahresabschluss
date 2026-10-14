'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

/**
 * Badge: Ist dieses Dokument signiert — und entspricht der aktuelle Stand
 * noch der signierten Fassung?
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-14:
 * Das Signieren **sperrt** nicht. Eine Korrektur erzeugt zwingend eine neue
 * Signatur, und der alte WORM-Satz darf nicht gelöscht werden.
 * Sichtbar machen muss aber genau das eine: dass die gerade angezeigten Daten
 * nicht mehr der signierten Fassung entsprechen.
 *
 * Ohne diese Anzeige sieht der Leser einen signierten Satz und kann nicht
 * unterscheiden, ob er noch der signierte ist. Bei einer Vorlage beim
 * Finanzamt ist genau das der Fehler, der ein Mandat kostet.
 *
 * Bewusst kein eigener Text im Backend-Zustand: der Klartext kommt als
 * `hinweis` mit, damit die Oberflaeche nichts uebersetzt oder verkuerzt.
 */

type EntityType = 'bilanz' | 'guv' | 'anhang' | 'abschluss';

type StatusResponse = {
  status: 'UNSIGNIERT' | 'SIGNIERT' | 'ABWEICHEND';
  signiertAm: string | null;
  anzahlSignaturen: number;
  geaendertNachSignatur: boolean;
  hinweis: string;
};

const TYP: Record<EntityType, string> = {
  bilanz: 'Bilanz',
  guv: 'GuV',
  anhang: 'Anhang',
  abschluss: 'Abschluss',
};

export function SignaturStatusBadge({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const [daten, setDaten] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    async function laden() {
      const token = getAccessToken();
      if (!token) return;
      try {
        const antwort = await apiFetch<StatusResponse>(
          `/signatur/status?entityType=${TYP[entityType]}&entityId=${encodeURIComponent(entityId)}`,
          { accessToken: token },
        );
        if (!abgebrochen) setDaten(antwort);
      } catch {
        // Kein Badge ist ein Anzeigeproblem, kein Datenverlust. Der Status
        // darf die Liste aber nicht auf einen Fehler-Durchschlag setzen.
        if (!abgebrochen) setDaten(null);
      }
    }
    void laden();
    return () => {
      abgebrochen = true;
    };
  }, [entityType, entityId]);

  if (!daten || daten.status === 'UNSIGNIERT') return null;

  if (daten.status === 'ABWEICHEND') {
    return (
      <span
        title={daten.hinweis}
        data-testid="signatur-status-abweichend"
        className="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-300"
      >
        ⚠ Signiert, danach geändert
      </span>
    );
  }

  return (
    <span
      title={daten.hinweis}
      data-testid="signatur-status-signiert"
      className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-300"
    >
      ✓ Signiert
      {daten.anzahlSignaturen > 1 ? ` (${daten.anzahlSignaturen}×)` : ''}
    </span>
  );
}
