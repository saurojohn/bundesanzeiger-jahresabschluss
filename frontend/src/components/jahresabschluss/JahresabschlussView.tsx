'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { P12UploadDialog } from '@/components/signatur/P12UploadDialog';
import { useSignaturBerechtigung, useMandantBerechtigung } from '@/lib/session';
import { SignaturStatusBadge } from '@/components/signatur/SignaturStatusBadge';

type JahresabschlussSummary = {
  id: string;
  geschaeftsjahr: number;
  status: 'DRAFT' | 'FINALIZED' | 'SIGNED' | 'SUBMITTED' | 'PUBLISHED';
  /** BAnz-Bestellnummer nach der Einreichung (Nachtrag 62). */
  banzBestellnummer: string | null;
  bilanzsumme: number;
  guvErgebnis: number;
  abgeschlossenAm: string | null;
  signiertAm: string | null;
  wormObjectKey: string | null;
};

/** Antwort von POST /api/jahresabschluss/:id/finalize. */
type FinalizeAntwort = {
  status: string;
  pruefungen: Array<{ gegenstand: string; bestanden: boolean; meldung: string }>;
  warnungen: Array<{ gegenstand: string; bestanden: boolean; meldung: string }>;
  saldoabgleich: {
    hinweis: string;
    abweichung: number | null;
    /** Wurde die Abweichung mit schriftlicher Begruendung freigegeben? */
    freigegeben?: boolean;
    /** Die Begruendung, mit der freigegeben wurde. */
    begruendung?: string;
  };
};

export function JahresabschlussView() {
  const t = useTranslations();
  const [list, setList] = useState<JahresabschlussSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Pruefungsergebnis des letzten Abschlussversuchs (null = noch keiner). */
  const [pruefung, setPruefung] = useState<FinalizeAntwort | null>(null);
  /** Geschaeftsjahr fuer den neu anzulegenden Abschluss. */
  const [jahr, setJahr] = useState(2025);
  /** Abschluss, dessen Signatur-Dialog offen ist (null = keiner). */
  const [signierZiel, setSignierZiel] = useState<string | null>(null);
  /**
   * BEFUND 2026-10-20 (Nachtrag 59, Entscheidung 1): Der Saldoabgleich
   * zwischen Bilanz und GuV **sperrt** jetzt. Die Abweichung kann aber mit
   * einer schriftlichen Begruendung freigegeben werden (Eigenkapital-
   * bewegungen, die das Produkt nicht erfasst).
   *
   * `begruendungZiel` haelt den Abschluss, fuer den die Begruendung noetig
   * ist — ohne ihn gaelte der Text im Panel fuer keinen bestimmten Abschluss.
   */
  const [begruendungZiel, setBegruendungZiel] = useState<string | null>(null);
  const [begruendung, setBegruendung] = useState('');
  /**
   * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): `SIGNED -> SUBMITTED ->
   * PUBLISHED` hatten keinen Bedienweg. Die Anwendung reicht nicht selbst
   * ein (es gibt keine Submission-API des Bundesanzeiger-Verlags) — die
   * Kanzlei meldet hier, was **draussen** passiert ist: die
   * BAnz-Bestellnummer und spaeter die Veroeffentlichung.
   */
  const [einreichenZiel, setEinreichenZiel] = useState<string | null>(null);
  const [bestellnummer, setBestellnummer] = useState('');
  /**
   * Wer darf einreichen? Die Kanzlei-Seite: STEUERBERATER und
   * KANZLEI_ADMIN. Der Wirtschaftspruefer bescheinigt (qeS), die Kanzlei
   * reicht ein — ein WP, der ohne Kanzlei-Beteiligung veroeffentlichen
   * koennte, waere die Vier-Augen-Kontrolle ausgehebelt.
   */
  const darfEinreichen = useMandantBerechtigung([
    'STEUERBERATER',
    'KANZLEI_ADMIN',
  ]);

  // BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Die Signatur des
  // **Jahresabschlusses** ist die Endabnahme — sie ist ausschliesslich dem
  // Wirtschaftspruefer vorbehalten (`@Roles('WIRTSCHAFTSPRUEFER')` an
  // `POST /api/signatur/sign-abschluss`).
  //
  // Der Knopf war trotzdem fuer jeden sichtbar. Ein STEUERBERATER hat ihn
  // gedrueckt, den P12 hochgeladen, das Passwort eingegeben — und **403**
  // bekommen. Nach der ganzen Arbeit.
  //
  // Die Regel ist mandantenbezogen: wer auf einem anderen Mandanten
  // Wirtschaftspruefer ist, ist es auf diesem nicht.
  const darfAbschlussSignieren = useSignaturBerechtigung('abschluss');

  useEffect(() => {
    void loadList();
  }, []);

  async function loadList() {
    setLoading(true);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      // Bugfix 2026-10-05: Ein `.catch(() => [])` hat JEDEN Serverfehler in
      // eine leere Liste verwandelt — ein Ausfall sah aus wie „noch kein
      // Jahresabschluss".
      //
      // Nachtrag 2026-10-17: Weil `GET /api/jahresabschluss` 404 lieferte,
      // wurde dieses Verhalten hier **produktiv zum Fangen des 404 benutzt**:
      //
      //     if (status === 404) return []; // "erwartet: Endpunkt fehlt noch"
      //
      // Damit war die Luecke unsichtbar: der Smoke-Test zaehlte die Seite
      // mit, und sie konnte nie Inhalt haben. Der Endpoint existiert jetzt;
      // ein 404 ist wieder ein Fehler und wird als solcher gemeldet. Eine
      // leere Liste ist jetzt eine Antwort des Servers, kein verschluckter
      // Fehler.
      const result = await apiFetch<JahresabschlussSummary[]>(
        `/jahresabschluss?mandantId=${mandantId}`,
        { accessToken: token },
      );
      setList(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Legt den Jahresabschluss fuer das gewaehlte Jahr an.
   *
   * Der Server meldet, wenn einer der drei Bestandteile fehlt — der
   * Anwender muss nicht raten, welcher.
   */
  /**
   * Meldet die Einreichung beim Bundesanzeiger.
   *
   * Die Bestellnummer ist Pflicht: sie ist der einzige Beleg fuer die
   * Einreichung. Der Server weist eine leere oder zu kurze Nummer mit 400
   * und eine doppelt vergebene mit 409 ab.
   */
  async function einreichen(id: string) {
    const token = getAccessToken();
    const mandantId = getActiveMandantId();
    if (!token || !mandantId) return;
    setError(null);
    try {
      await apiFetch(`/jahresabschluss/${id}/einreichen`, {
        method: 'POST',
        accessToken: token,
        // Kein `mandantId` im Body: der DTO verbietet unbekannte Felder
        // (`forbidNonWhitelisted`), und der Mandantenkontext kommt aus dem
        // Guard. Die anderen Routen machen es genauso.
        body: JSON.stringify({ banzBestellnummer: bestellnummer.trim() }),
      });
      setEinreichenZiel(null);
      setBestellnummer('');
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  /** Meldet, dass der Bundesanzeiger den Abschluss veroeffentlicht hat. */
  async function veroeffentlichen(id: string) {
    const token = getAccessToken();
    const mandantId = getActiveMandantId();
    if (!token || !mandantId) return;
    setError(null);
    try {
      await apiFetch(`/jahresabschluss/${id}/veroeffentlichen`, {
        method: 'POST',
        accessToken: token,
        body: JSON.stringify({}),
      });
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  async function anlegen() {
    const token = getAccessToken();
    const mandantId = getActiveMandantId();
    if (!token || !mandantId) return;
    setError(null);
    try {
      await apiFetch('/jahresabschluss', {
        method: 'POST',
        accessToken: token,
        body: JSON.stringify({ mandantId, geschaeftsjahr: jahr }),
      });
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  /**
   * Schliesst den Jahresabschluss ab und zeigt das Pruefungsergebnis.
   *
   * Der Server entscheidet, ob abgeschlossen werden darf — die Oberflaeche
   * zeigt nur, was er sagt. Bei 409 (nicht vollstaendig) werden die
   * beanstandeten Punkte angezeigt statt einer nackten Fehlermeldung.
   */
  async function abschliessen(id: string, grund?: string) {
    const token = getAccessToken();
    const mandantId = getActiveMandantId();
    if (!token || !mandantId) return;
    setError(null);
    try {
      const antwort = await apiFetch<FinalizeAntwort>(
        `/jahresabschluss/${id}/finalize?mandantId=${mandantId}`,
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify(grund ? { begruendung: grund } : {}),
        },
      );
      setPruefung(antwort);
      setBegruendungZiel(null);
      setBegruendung('');
      await loadList();
    } catch (err) {
      const body = (err as { body?: {
        pruefungen?: FinalizeAntwort['pruefungen'];
        begruendungErforderlich?: boolean;
      } }).body;
      const pruefungen = body?.pruefungen;
      // Der Server sagt, ob eine Begruendung den Weg zur Freigabeoeffnet.
      setBegruendungZiel(body?.begruendungErforderlich ? id : null);
      if (pruefungen) {
        // Der Server hat die Pruefungen mitgeschickt — anzeigen statt
        // einer nackten Fehlermeldung.
        setPruefung({
          status: 'DRAFT',
          pruefungen,
          warnungen: [],
          saldoabgleich: { hinweis: '', abweichung: null },
        });
      } else {
        setError(err instanceof Error ? err.message : t('errors.network.message'));
      }
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-end gap-2">
        <div>
          <label
            htmlFor="jahresabschluss-jahr"
            className="block text-xs font-medium text-slate-700"
          >
            {t('jahresabschluss.fields.geschaeftsjahr')}
          </label>
          <input
            id="jahresabschluss-jahr"
            type="number"
            min={2000}
            max={2100}
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm num-de"
          />
        </div>
        <button
          type="button"
          onClick={() => anlegen()}
          data-testid="jahresabschluss-anlegen"
          className="rounded-md bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700"
        >
          {t('jahresabschluss.actions.create')}
        </button>
        <p className="pb-2 text-xs text-slate-400">
          {t('jahresabschluss.actions.createHint')}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">
            {t('jahresabschluss.noAbschluss')}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Erstellen Sie zunächst Bilanz + GuV + Anhang für ein Geschäftsjahr,
            dann wird hier der kombinierte Jahresabschluss angezeigt.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('jahresabschluss.fields.geschaeftsjahr')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('jahresabschluss.fields.status')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                  {t('jahresabschluss.fields.bilanzSumme')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                  {t('jahresabschluss.fields.guvErgebnis')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700">
                  {t('jahresabschluss.fields.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 num-de">{j.geschaeftsjahr}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                        (j.status === 'DRAFT'
                          ? 'bg-amber-100 text-amber-800'
                          : j.status === 'SIGNED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : j.status === 'PUBLISHED'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700')
                      }
                    >
                      {t(`jahresabschluss.status.${j.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {j.bilanzsumme.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {j.guvErgebnis.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      {j.status === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={() => abschliessen(j.id)}
                          className="text-sm text-brand-600 hover:text-brand-700"
                        >
                          {t('jahresabschluss.actions.finalize')}
                        </button>
                      )}
                      {/* BEFUND 2026-10-17: Diese Schaltfläche hatte
                          **keinen `onClick`** — sie war ein toter Knopf. Ein
                          Klick tat nichts, ohne jede Fehlermeldung.

                          Das ist derselbe Fehler, den das Projekt am
                          2026-10-05 für GuV und Anhang gefunden und behoben
                          hat ("`POST /signatur/sign-guv` existiert im
                          Backend, hatte aber keinen Bedienweg"). Er wurde
                          beim Bau dieser Ansicht unverändert wiederholt.

                          Der Bedienweg existierte die ganze Zeit: `P12UploadDialog`
                          nimmt `jahresabschlussId` + `signTarget="abschluss"`
                          entgegen, und `ExportActions` reicht beides für
                          `entityType="abschluss"` durch. Es fehlte nur der
                          Aufruf.

                          Sichtbar bei `FINALIZED` **und** bei `SIGNED`:
                          ENTSCHEIDUNG 2026-10-21 (Nachtrag 78, Frage 1 = A) —
                          ein Abschluss im Status SIGNED darf erneut signiert
                          werden. Das ist der Korrekturweg: die Entscheidung der
                          Fachverantwortlichen vom 2026-10-14 sagt „Ein
                          Korrekturvorgang erzeugt zwingend eine neue Signatur".
                          Bis eben war der Knopf bei SIGNED unsichtbar — der
                          Server haette es auch mit 409 abgewiesen (Nachtrag 35).

                          `DRAFT` bleibt unsichtbar: der Server wuerde eine
                          Signatur mit 409 abweisen („eine Signatur auf einen
                          unfertigen Abschluss bescheinigt eine Vollstaendigkeit,
                          die es nicht gibt") — der Knopf darf den Anwender nicht
                          erst in einen Fehler laufen lassen, den er selbst nicht
                          ausloesen kann. */}
                      {(j.status === 'FINALIZED' || j.status === 'SIGNED') &&
                        darfAbschlussSignieren && (
                          <button
                            type="button"
                            onClick={() => setSignierZiel(j.id)}
                            data-testid="jahresabschluss-signieren"
                            className="text-sm text-brand-600 hover:text-brand-700"
                          >
                            {j.status === 'SIGNED'
                              ? t('jahresabschluss.actions.resignAbschluss')
                              : t('jahresabschluss.actions.signAbschluss')}
                          </button>
                        )}
                      {j.status === 'SIGNED' && !darfAbschlussSignieren && (
                        <span className="text-xs text-slate-400">
                          {t('jahresabschluss.actions.alreadySigned')}
                        </span>
                      )}
                      {/* BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): der
                          Einreichungs- und der Veroeffentlichungsweg. */}
                      {j.status === 'SIGNED' && darfEinreichen && (
                        <button
                          type="button"
                          onClick={() => {
                            setEinreichenZiel(j.id);
                            setBestellnummer('');
                          }}
                          data-testid="jahresabschluss-einreichen"
                          className="text-sm text-brand-600 hover:text-brand-700"
                        >
                          {t('jahresabschluss.actions.submit')}
                        </button>
                      )}
                      {j.status === 'SUBMITTED' && darfEinreichen && (
                        <button
                          type="button"
                          onClick={() => void veroeffentlichen(j.id)}
                          data-testid="jahresabschluss-veroeffentlichen"
                          className="text-sm text-brand-600 hover:text-brand-700"
                        >
                          {t('jahresabschluss.actions.publish')}
                        </button>
                      )}
                      {einreichenZiel === j.id && (
                        <div className="mt-1 flex flex-col items-end gap-1">
                          <label
                            htmlFor={`bestellnummer-${j.id}`}
                            className="text-[10px] text-slate-500"
                          >
                            {t('jahresabschluss.fields.bestellnummer')}
                          </label>
                          <input
                            id={`bestellnummer-${j.id}`}
                            data-testid="jahresabschluss-bestellnummer"
                            value={bestellnummer}
                            onChange={(e) => setBestellnummer(e.target.value)}
                            className="w-44 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void einreichen(j.id)}
                            disabled={bestellnummer.trim().length < 5}
                            data-testid="jahresabschluss-einreichen-bestaetigen"
                            className="rounded-md bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            {t('jahresabschluss.actions.submitConfirm')}
                          </button>
                        </div>
                      )}
                      {j.banzBestellnummer && (
                        <span className="text-[10px] text-slate-500">
                          {t('jahresabschluss.fields.vorgang')}:{' '}
                          {j.banzBestellnummer}
                        </span>
                      )}
                      {/* BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15):
                          Das Badge unterscheidet „der Jahresabschluss ist
                          signiert" (Endabnahme) von „ein Bestandteil wurde
                          geprueft". Ohne es war beides nicht unterscheidbar
                          — der Abschluss zeigte „Signiert", obwohl nur die
                          GuV geprueft war. */}
                      {/* BEFUND 2026-10-21 (Nachtrag 77/78): Das Badge war
                          bei `SIGNED` **ausgeblendet** — genau dort, wo die
                          Abweichung sichtbar sein muss (Entscheidung
                          2026-10-14: „es muss sichtbar sein, wenn die
                          vorgelegten Daten nicht mehr der signierten Fassung
                          entsprechen"). Es ist jetzt fuer FINALIZED und
                          SIGNED sichtbar; der DRAFT-Zustand bleibt ohne
                          Badge (dort gibt es nichts zu vergleichen). */}
                      {(j.status === 'FINALIZED' || j.status === 'SIGNED') && (
                        <SignaturStatusBadge
                          entityType="abschluss"
                          entityId={j.id}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pruefung && (() => {
            // BEFUND 2026-10-17: Die Ueberschrift war fest auf
            // "Alle Pflichtangaben erfuellt." gesetzt und jede Pruefung
            // wurde mit einem gruenen Haken und gruener Schrift gerendert —
            // **auch dann, wenn der Server mit 409 abgelehnt hatte**.
            //
            // Gemessen: `POST /finalize` antwortete mit drei nicht
            // bestandenen Pruefungen ("steht noch auf DRAFT"). Die
            // Oberflaeche zeigte darueber den Satz "Alle Pflichtangaben
            // erfuellt." und drei gruene Haekchen. Auf einem
            // GoBD-Bildschirm ist das eine falsche Aussage, keine
            // Kosmetik.
            //
            // Die Quelle der Wahrheit ist `bestanden` des Servers, nicht
            // der HTTP-Statuscode und nicht `pruefung.status`.
            const offen = pruefung.pruefungen.filter((p) => !p.bestanden);
            const vollstaendig = offen.length === 0;
            return (
              <div
                data-testid="jahresabschluss-pruefung"
                data-ergebnis={vollstaendig ? 'vollstaendig' : 'offen'}
                className="mt-4 rounded-lg border border-slate-200 bg-white p-4"
              >
                <p
                  className={
                    'mb-2 text-sm font-medium ' +
                    (vollstaendig ? 'text-emerald-700' : 'text-red-700')
                  }
                >
                  {vollstaendig
                    ? t('jahresabschluss.pruefung.ok')
                    : t('jahresabschluss.pruefung.offen')}
                </p>
                <ul className="space-y-1 text-xs">
                  {pruefung.pruefungen.map((p) => (
                    <li
                      key={p.gegenstand}
                      className={p.bestanden ? 'text-emerald-700' : 'text-red-700'}
                    >
                      {p.bestanden ? '✓' : '✗'} {p.gegenstand}: {p.meldung}
                    </li>
                  ))}
                  {pruefung.warnungen.map((p) => (
                    <li key={p.gegenstand} className="text-amber-700">
                      ⚠ {p.gegenstand}: {p.meldung}
                    </li>
                  ))}
                </ul>
                {pruefung.saldoabgleich.abweichung !== null && (
                  <p className="mt-2 text-xs text-amber-700">
                    {pruefung.saldoabgleich.hinweis}
                  </p>
                )}

                {begruendungZiel && (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <label
                      htmlFor="jahresabschluss-begruendung"
                      className="block text-xs font-medium text-slate-800"
                    >
                      {t('jahresabschluss.pruefung.begruendungLabel')}
                    </label>
                    <textarea
                      id="jahresabschluss-begruendung"
                      data-testid="jahresabschluss-begruendung"
                      value={begruendung}
                      onChange={(e) => setBegruendung(e.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      data-testid="jahresabschluss-freigeben"
                      onClick={() => void abschliessen(begruendungZiel, begruendung)}
                      disabled={begruendung.trim().length < 20}
                      className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {t('jahresabschluss.pruefung.freigeben')}
                    </button>
                    <p className="mt-1 text-xs text-slate-600">
                      {t('jahresabschluss.pruefung.begruendungHilfe')}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {signierZiel && (
        <P12UploadDialog
          jahresabschlussId={signierZiel}
          signTarget="abschluss"
          onClose={() => {
            setSignierZiel(null);
            // Nach der Signatur steht der Abschluss auf `SIGNED` — die Liste
            // muss den neuen Zustand zeigen, sonst bleibt die Zeile auf
            // "Finalisiert" und der Knopf verschwindet nicht.
            void loadList();
          }}
        />
      )}
    </div>
  );
}