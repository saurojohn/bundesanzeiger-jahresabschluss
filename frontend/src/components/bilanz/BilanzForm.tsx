'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { ExportActions } from '@/components/exports/ExportActions';

type HgbPosition = {
  id: string;
  parentId?: string;
  bezeichnung: string;
  kontonummerPrefix: string;
  seite?: 'AKTIVA' | 'PASSIVA';
  gruppe?: string; // "A" | "B" | "C" | ...
};

type HgbSchemaPosition = {
  id: string;
  kontonummer: string;
  bezeichnung: string;
  seite: 'AKTIVA' | 'PASSIVA';
  gruppe: string;
};

/**
 * `GET /api/bilanz/schema` liefert ein FLACHES Array aller
 * HGB-Positionen mit `seite` — nicht `{ aktiva: [], passiva: [] }`.
 *
 * Bugfix 2026-10-05: Der Typ behauptete die Objektform. Beim Anlegen einer
 * neuen Bilanz lief `schemaData.aktiva.map(...)` in einen TypeError:
 * „Cannot read properties of undefined (reading 'map')" — als rotes Band
 * in einer deutschen Oberfläche, 0 Positionszeilen, und der Knopf
 * „Speichern" blieb AKTIV. Ergebnis: eine leere Jahresbilanz ließ sich
 * anlegen und wanderte in E-Bilanz und Bundesanzeiger-Meldung.
 */
type HgbSchema = HgbSchemaPosition[];

type BilanzPosition = {
  id?: string;
  kontonummer: string;
  bezeichnung: string;
  seite: 'AKTIVA' | 'PASSIVA';
  betragVorjahr: number | null;
  betragAktuell: number;
  reihenfolge: number;
  bemerkung?: string | null;
};

type Bilanz = {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
  hinweise: string | null;
  positionen: BilanzPosition[];
};

type Validation = {
  aktivaSumme: number;
  passivaSumme: number;
  differenz: number;
  saldostimmt: boolean;
  fehlendePflichtfelder: string[];
};

export function BilanzForm({
  bilanzId,
  onCancel,
  onSaved,
}: {
  bilanzId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [schema, setSchema] = useState<HgbSchema | null>(null);
  /**
   * Status des geladenen Satzes. Das Backend laesst Positionsaenderungen
   * ausschliesslich im DRAFT zu (`BilanzService.update`), sonst HTTP 400
   * "Positionen koennen nur in DRAFT-Phase geaendert werden". Das Formular
   * sendete `positionen` aber immer mit — ein VALIDATED- oder ARCHIVED-Satz
   * war damit grundsaetzlich nicht speicherbar, ohne dass die Oberflaeche
   * den Grund erklaert haette. Bugfix 2026-10-04.
   */
  const [status, setStatus] = useState<'DRAFT' | 'VALIDATED' | 'ARCHIVED'>(
    'DRAFT',
  );
  const positionenSperre = bilanzId !== undefined && status !== 'DRAFT';
  const [geschaeftsjahr, setGeschaeftsjahr] = useState<number>(
    new Date().getFullYear(),
  );
  const [hinweise, setHinweise] = useState('');
  const [positionen, setPositionen] = useState<BilanzPosition[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedIds, setRelatedIds] = useState<{
    guvId?: string;
    anhangId?: string;
  }>({});
  const [savedBilanzId, setSavedBilanzId] = useState<string | null>(bilanzId ?? null);

  useEffect(() => {
    void init();
  }, [bilanzId]);

  async function init() {
    setLoading(true);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const schemaData = await apiFetch<HgbSchema>('/bilanz/schema', {
        accessToken: token,
      });
      setSchema(schemaData);

      if (bilanzId) {
        const data = await apiFetch<Bilanz>(`/bilanz/${bilanzId}`, {
          accessToken: token,
        });
        setGeschaeftsjahr(data.geschaeftsjahr);
        setHinweise(data.hinweise ?? '');
        setPositionen(data.positionen);
        setStatus(data.status);

        // Zugehörige GuV + Anhang für gleiches GJ finden
        const mandantId = getActiveMandantId();
        if (mandantId) {
          const [guvList, anhangList] = await Promise.all([
            apiFetch<Array<{ id: string; geschaeftsjahr: number }>>(
              `/guv?mandantId=${mandantId}`,
              { accessToken: token },
            ),
            apiFetch<Array<{ id: string; geschaeftsjahr: number }>>(
              `/anhang?mandantId=${mandantId}`,
              { accessToken: token },
            ),
          ]);
          const related: { guvId?: string; anhangId?: string } = {};
          const matchingGuv = guvList.find(
            (g) => g.geschaeftsjahr === data.geschaeftsjahr,
          );
          const matchingAnhang = anhangList.find(
            (a) => a.geschaeftsjahr === data.geschaeftsjahr,
          );
          if (matchingGuv) related.guvId = matchingGuv.id;
          if (matchingAnhang) related.anhangId = matchingAnhang.id;
          setRelatedIds(related);
        }
      } else {
        // Initial positionen aus Schema. Die API liefert EIN flaches
        // Array mit `seite` je Position (siehe HgbSchema).
        const initial: BilanzPosition[] = schemaData.map((p, idx) => ({
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          seite: p.seite,
          betragVorjahr: null,
          betragAktuell: 0,
          reihenfolge: idx + 1,
        }));
        setPositionen(initial);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  const aktivaSumme = useMemo(
    () =>
      positionen
        .filter((p) => p.seite === 'AKTIVA')
        .reduce((s, p) => s + (p.betragAktuell || 0), 0),
    [positionen],
  );

  const passivaSumme = useMemo(
    () =>
      positionen
        .filter((p) => p.seite === 'PASSIVA')
        .reduce((s, p) => s + (p.betragAktuell || 0), 0),
    [positionen],
  );

  const saldoDifferenz = aktivaSumme - passivaSumme;
  const saldoStimmt = Math.abs(saldoDifferenz) < 0.01;

  function updatePosition(idx: number, patch: Partial<BilanzPosition>) {
    setPositionen((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      const payload = {
        mandantId,
        geschaeftsjahr,
        hinweise: hinweise || undefined,
        positionen: positionen.map((p, idx) => ({
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          seite: p.seite,
          betragVorjahr: p.betragVorjahr,
          betragAktuell: p.betragAktuell,
          reihenfolge: idx + 1,
          bemerkung: p.bemerkung,
        })),
      };
      if (bilanzId) {
        // PATCH nimmt NUR die veraenderbaren Felder — `mandantId` und
        // `geschaeftsjahr` sind laut UpdateBilanzDto unveraenderlich und
        // werden sonst mit HTTP 400 abgelehnt (forbidNonWhitelisted).
        await apiFetch(`/bilanz/${bilanzId}`, {
          method: 'PATCH',
          accessToken: token,
          body: JSON.stringify({
            hinweise: payload.hinweise,
            // Positionen nur im DRAFT — sonst lehnt das Backend den
            // gesamten PATCH mit 400 ab, auch wenn nur `hinweise`
            // geaendert wurden.
            ...(positionenSperre ? {} : { positionen: payload.positionen }),
          }),
        });
        setSavedBilanzId(bilanzId);
      } else {
        const result = await apiFetch<Bilanz>('/bilanz', {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify(payload),
        });
        if (result?.id) setSavedBilanzId(result.id);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    try {
      const token = getAccessToken();
      if (!bilanzId || !token) return;
      const result = await apiFetch<Validation>(
        `/bilanz/${bilanzId}/validate`,
        {
          method: 'POST',
          accessToken: token,
        },
      );
      setValidation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {bilanzId ? t('bilanz.editBilanz') : t('bilanz.newBilanz')}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          {bilanzId && (
            <button
              type="button"
              onClick={handleValidate}
              className="rounded-md border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              {t('bilanz.validation.validieren')}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('bilanz.actions.save')}
          </button>
          {positionenSperre && (
            <p
              className="text-xs text-amber-700"
              data-testid="bilanz-positionen-gesperrt"
            >
              {t('bilanz.positionenGesperrt')}
            </p>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('bilanz.geschaeftsjahr')}
          </label>
          <input
            type="number"
            min={1900}
            max={2100}
            value={geschaeftsjahr}
            onChange={(e) => setGeschaeftsjahr(Number(e.target.value))}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 num-de"
            disabled={!!bilanzId}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Live-Saldo-Banner */}
      <div
        className={
          'mb-4 rounded-md p-3 text-sm flex items-center justify-between border ' +
          (saldoStimmt
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-amber-50 border-amber-200 text-amber-800')
        }
      >
        <div>
          <span className="font-medium">Aktiva:</span>{' '}
          <span className="num-de">
            {aktivaSumme.toLocaleString('de-DE', {
              style: 'currency',
              currency: 'EUR',
            })}
          </span>{' '}
          · <span className="font-medium">Passiva:</span>{' '}
          <span className="num-de">
            {passivaSumme.toLocaleString('de-DE', {
              style: 'currency',
              currency: 'EUR',
            })}
          </span>{' '}
          · <span className="font-medium">Differenz:</span>{' '}
          <span className="num-de">
            {saldoDifferenz.toLocaleString('de-DE', {
              style: 'currency',
              currency: 'EUR',
            })}
          </span>
        </div>
        <div className="font-medium">
          {saldoStimmt
            ? t('bilanz.validation.saldostimmt')
            : t('bilanz.validation.saldostimmtNein', {
                differenz: saldoDifferenz.toFixed(2),
              })}
        </div>
      </div>

      {validation && validation.fehlendePflichtfelder.length > 0 && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {t('bilanz.validation.fehlendePflichtfelder', {
            felder: validation.fehlendePflichtfelder.join(', '),
          })}
        </div>
      )}

      {/* Side-by-side Aktiva / Passiva */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PositionColumn
          disabled={positionenSperre}
          title="Aktiva"
          seite="AKTIVA"
          positionen={positionen}
          onChange={updatePosition}
        />
        <PositionColumn
          disabled={positionenSperre}
          title="Passiva"
          seite="PASSIVA"
          positionen={positionen}
          onChange={updatePosition}
        />
      </div>

      <div className="mt-6">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {t('bilanz.hinweise')}
        </label>
        <textarea
          rows={3}
          value={hinweise}
          onChange={(e) => setHinweise(e.target.value)}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {bilanzId && savedBilanzId && (
        <div className="mt-6">
          <ExportActions
            entityType="bilanz"
            entityId={savedBilanzId}
            bilanzId={savedBilanzId}
            guvId={relatedIds.guvId}
            anhangId={relatedIds.anhangId}
            canSign
          />
        </div>
      )}
    </div>
  );
}

function PositionColumn({
  title,
  seite,
  positionen,
  onChange,
  disabled = false,
}: {
  title: string;
  seite: 'AKTIVA' | 'PASSIVA';
  positionen: BilanzPosition[];
  onChange: (idx: number, patch: Partial<BilanzPosition>) => void;
  /** true, wenn der Datensatz nicht im DRAFT ist — Positionen sind dann
   *  gesperrt (Backend lehnt die Änderung mit 400 ab). */
  disabled?: boolean;
}) {
  const t = useTranslations();
  const filtered = positionen.map((p, idx) => ({ p, idx })).filter((x) => x.p.seite === seite);

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 w-24">
                {t('bilanz.fields.kontonummer')}
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                {t('bilanz.fields.bezeichnung')}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-32">
                {t('bilanz.fields.betragVorjahr')}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-32">
                {t('bilanz.fields.betragAktuell')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(({ p, idx }) => (
              <tr key={idx}>
                <td className="px-3 py-1.5 num-de text-slate-600">
                  {p.kontonummer}
                </td>
                <td className="px-3 py-1.5 text-slate-900">{p.bezeichnung}</td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    disabled={disabled}
                    value={p.betragVorjahr ?? ''}
                    onChange={(e) =>
                      onChange(idx, {
                        betragVorjahr: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="block w-full text-right rounded border border-slate-200 px-2 py-1 text-sm num-de focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    disabled={disabled}
                    value={p.betragAktuell || ''}
                    onChange={(e) =>
                      onChange(idx, {
                        betragAktuell: Number(e.target.value) || 0,
                      })
                    }
                    className="block w-full text-right rounded border border-slate-200 px-2 py-1 text-sm num-de focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}